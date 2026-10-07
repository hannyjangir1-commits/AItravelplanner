import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { generateTravelPlanService, modifyTravelPlanService } from './aiService.js';
import { validateGeneratePlanRequest, validateModifyPlanRequest, isValidUuid } from './validation.js';
import { testDbConnection } from './db.js';
import authRouter from './routes/auth.js';
import { optionalAuth, requireAuth } from './middleware/auth.js';
import { saveTravelPlan, getTravelPlansByUserId, getTravelPlanByIdForUser } from './db/travelPlans.js';
import { runStartupMigrations, checkDbHealth } from './db/init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BUG-02: Resolve .env path relative to __dirname (dist/index.js -> server/.env)
// This ensures server/.env is loaded correctly even when npm start is run from the project root.
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
// Secondary fallback: also attempt the current working directory .env (local dev / Docker)
dotenv.config({ override: false });

const app = express();
const PORT = process.env.PORT || 5000;

// Enable trust proxy for Render reverse proxy HTTPS detection and secure cookies
app.set('trust proxy', 1);

// Security: Disable Express fingerprinting header
app.disable('x-powered-by');

// Performance: Gzip/Deflate compression for API JSON responses and static assets
app.use(compression());

// Security: Standard HTTP security headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Serve React static files in production
const clientDistPath = process.env.CLIENT_DIST_PATH || path.resolve(__dirname, '../../client/dist');
console.log('[DEBUG] Serving static files from:', clientDistPath);

// Serve static assets from /assets with immutable caching
app.use('/assets', express.static(path.join(clientDistPath, 'assets'), {
  immutable: true,
  maxAge: '1y'
}));

// A missing JS/CSS asset in /assets must return 404 text/plain, NOT index.html and NOT JSON
app.all('/assets/*', (_req: Request, res: Response) => {
  res.status(404).type('text/plain').send('Asset not found');
});

// Serve remaining root static files (favicon, robots.txt, etc.)
app.use(express.static(clientDistPath));

// Security: Dynamic CORS configuration allowing localhost development, Render domains, and configured origins
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

if (process.env.RENDER_EXTERNAL_URL) {
  envOrigins.push(process.env.RENDER_EXTERNAL_URL);
}

const allowedOrigins = [...defaultAllowedOrigins, ...envOrigins];

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin requests, local dev origins, or curl/server-to-server calls with no origin header
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    try {
      const parsedOrigin = new URL(origin);
      if (
        parsedOrigin.hostname === 'localhost' ||
        parsedOrigin.hostname === '127.0.0.1' ||
        parsedOrigin.hostname.endsWith('.onrender.com')
      ) {
        return callback(null, true);
      }
    } catch {
      // Invalid URL format falls through
    }

    // Disallow cross-origin requests by passing false (standard CORS rejection without throwing 500 Error)
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Cookie parsing middleware for authenticated sessions
app.use(cookieParser());

// Security: Enforce explicit 100kb body size limit to prevent memory exhaustion attacks
app.use(express.json({ limit: '100kb' }));

// Handle malformed JSON and payload size errors safely before hitting route handlers
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: 'Request payload exceeds the 100KB limit.'
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      success: false,
      error: 'Malformed JSON payload. Please ensure the request body is valid JSON.'
    });
    return;
  }
  next(err);
});

// Security: Rate limiting for AI generation and modification endpoints (30 requests per 15 mins per IP)
const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Rate limit exceeded: Too many travel planning requests from your network. Please wait a few minutes before trying again.'
  }
});

// Health check endpoint (safe status check without secret leakage)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'ok',
    service: 'AI Travel Agent API'
  });
});

// Safe database health check endpoint
app.get('/api/db-health', async (_req: Request, res: Response) => {
  const health = await checkDbHealth();
  const statusCode = health.success ? 200 : 503;
  res.status(statusCode).json({
    success: health.success,
    database: health.database,
    schemaReady: health.schemaReady,
    requiredColumns: health.requiredColumns
  });
});

// Authentication routes (Username/password authentication flow)
app.use('/api/auth', authRouter);

// Endpoint 1: Generate initial travel plan
app.post('/api/generate-travel-plan', requireAuth, aiRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = validateGeneratePlanRequest(req.body);
    if (!validation.isValid || !validation.data) {
      res.status(400).json({
        success: false,
        error: validation.error || 'Invalid travel plan request.'
      });
      return;
    }

    const result = await generateTravelPlanService(validation.data);

    // Persist the successfully generated itinerary to PostgreSQL for the authenticated user
    if (req.user?.userId && result.plan) {
      try {
        await saveTravelPlan(req.user.userId, validation.data, result.plan);
      } catch (dbError: any) {
        // Robustness: DB unavailability must NOT fail plan generation or leak SQL/credentials
        console.error('[TravelPlan Save DB Error]:', dbError?.message || dbError);
      }
    }

    res.json({
      success: true,
      data: result.plan,
      isDemo: result.isDemo,
      message: result.message || (result.isDemo
        ? 'Generated in demo mode. Provide GEMINI_API_KEY in server/.env for live AI generation.'
        : 'Plan generated successfully.')
    });
  } catch (error: any) {
    // Log technical error details internally for developers without exposing to clients
    console.error('[Generate Plan Route Error]:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate travel plan. Please try again later.'
    });
  }
});

// Endpoint 2: Modify existing travel plan
app.post('/api/modify-travel-plan', requireAuth, aiRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = validateModifyPlanRequest(req.body);
    if (!validation.isValid || !validation.data) {
      res.status(400).json({
        success: false,
        error: validation.error || 'Invalid travel plan modification request.'
      });
      return;
    }

    const result = await modifyTravelPlanService(validation.data);
    res.json({
      success: true,
      data: result.plan,
      isDemo: result.isDemo,
      message: result.message || (result.isDemo
        ? 'Live AI modification was unavailable. Your existing travel plan has been preserved intact.'
        : 'Plan updated successfully.')
    });
  } catch (error: any) {
    // Log technical error details internally for developers without exposing to clients
    console.error('[Modify Plan Route Error]:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to modify travel plan. Please try again later.'
    });
  }
});

// Endpoint 3: Retrieve authenticated user's saved travel plans (history list)
app.get('/api/travel-plans', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const itineraries = await getTravelPlansByUserId(userId);
    res.json({
      itineraries
    });
  } catch (error: any) {
    console.error('[Get Travel Plans Route Error]:', error?.message || error);
    res.status(500).json({
      error: 'Unable to load travel history.'
    });
  }
});

// Endpoint 4: Retrieve full travel plan detail by ID for authenticated user
app.get('/api/travel-plans/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const { id } = req.params;
    if (!id || !isValidUuid(id)) {
      res.status(400).json({
        error: 'Invalid itinerary ID.'
      });
      return;
    }

    const itinerary = await getTravelPlanByIdForUser(id, userId);
    if (!itinerary) {
      res.status(404).json({
        error: 'Itinerary not found.'
      });
      return;
    }

    res.json({
      itinerary
    });
  } catch (error: any) {
    console.error('[Get Travel Plan Detail Route Error]:', error?.message || error);
    res.status(500).json({
      error: 'Unable to load itinerary.'
    });
  }
});

// Explicit 404 handler for API routes
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Requested API endpoint does not exist.'
  });
});



// Fallback route for SPA (React router / client-side routing)
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Global unhandled error handler middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Global Server Error]:', err?.message || err);
  res.status(err.status || 500).json({
    success: false,
    error: 'An internal server error occurred. Please try again later.'
  });
});

async function startServer(): Promise<void> {
  // If DATABASE_URL is configured, initialize database schema BEFORE starting HTTP server
  if (process.env.DATABASE_URL) {
    console.log('[Startup] DATABASE_URL detected. Initializing database schema and migrations...');
    const migrationResult = await runStartupMigrations();
    if (!migrationResult.success) {
      console.error('[Startup Fatal Error] Database schema initialization failed:', migrationResult.message);
      console.error('[Startup Fatal Error] HTTP server will NOT start because the database is not ready.');
      process.exit(1);
    }
    console.log('[Startup] Database schema verified successfully.');
  } else {
    console.log('[Notice] DATABASE_URL is not set. Demo/fallback mode is enabled. Database migrations skipped.');
  }

  app.listen(PORT, () => {
    console.log(`AI Travel Agent server running on http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      console.log('Notice: GEMINI_API_KEY is not set in server/.env. Demo fallback mode is enabled.');
    } else {
      console.log('Gemini API key detected.');
    }
  });
}

startServer().catch((fatalErr) => {
  console.error('[Server Fatal Error]:', fatalErr?.message || fatalErr);
  process.exit(1);
});
