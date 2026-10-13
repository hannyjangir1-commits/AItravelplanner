import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';

// Resolve IPv4 first to prevent connection timeouts on Windows environments without public IPv6 routing
dns.setDefaultResultOrder('ipv4first');
import { generateTravelPlanService, modifyTravelPlanService } from './aiService.js';
import { validateGeneratePlanRequest, validateModifyPlanRequest, isValidUuid } from './validation.js';
import { testDbConnection, pool } from './db.js';
import authRouter from './routes/auth.js';
import { optionalAuth, requireAuth } from './middleware/auth.js';
import { saveTravelPlan, getTravelPlansByUserId, getTravelPlanByIdForUser, updateSavedTravelPlan, deleteTravelPlanForUser } from './db/travelPlans.js';
import { runStartupMigrations, checkDbHealth } from './db/init.js';
import { isAuthConfigured } from './auth/config.js';
import { createCsrfMiddleware } from './middleware/csrf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BUG-02: Resolve .env path relative to __dirname (dist/index.js -> server/.env)
// This ensures server/.env is loaded correctly even when npm start is run from the project root.
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
// Secondary fallback: also attempt the current working directory .env (local dev / Docker)
dotenv.config({ override: false });

export const app = express();
const PORT = process.env.PORT || 5000;

// Enable trust proxy for Render reverse proxy HTTPS detection and secure cookies
app.set('trust proxy', 1);

// Security: Disable Express fingerprinting header
app.disable('x-powered-by');

// Performance: Gzip/Deflate compression for API JSON responses and static assets
app.use(compression());

// Security: Standard HTTP security headers with strict CSP and conditional HSTS
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy for React SPA, Google Fonts, and secure assets
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', cspDirectives);

  // Strict-Transport-Security: Only when confirmed HTTPS in production
  if (process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

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

/**
 * Resolves the strict list of allowed origins.
 * In development: includes local dev ports (5173, 5000, 3000) on localhost and 127.0.0.1.
 * In production: strictly uses explicit origins from ALLOWED_ORIGINS / CORS_ORIGINS and RENDER_EXTERNAL_URL.
 * Never reflects arbitrary origins and never allows wildcard '*' with credentials.
 */
export function getAllowedOrigins(): string[] {
  const isProd = process.env.NODE_ENV === 'production';
  const origins: string[] = [];

  const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '';
  if (rawOrigins.trim()) {
    const parsed = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);
    origins.push(...parsed);
  }

  if (process.env.RENDER_EXTERNAL_URL) {
    origins.push(process.env.RENDER_EXTERNAL_URL.trim());
  }

  if (!isProd) {
    origins.push(
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    );
  }

  return Array.from(new Set(origins));
}

// Security: Strict CORS policy rejecting untrusted domains
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser calls (e.g. server-to-server, curl) or same-origin calls without Origin header
    if (!origin) {
      return callback(null, true);
    }

    const allowed = getAllowedOrigins();
    if (allowed.includes(origin)) {
      return callback(null, true);
    }

    // Reject cross-origin requests from unlisted domains without reflecting the origin
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Accept'],
  exposedHeaders: ['X-CSRF-Token']
}));

// Cookie parsing middleware for authenticated sessions
app.use(cookieParser());

// Security: Anti-CSRF protection for state-changing requests on authenticated sessions
app.use(createCsrfMiddleware(getAllowedOrigins));

// Security: Enforce explicit 1mb body size limit to accommodate travel plans with verified place catalogs
app.use(express.json({ limit: '1mb' }));

// Handle malformed JSON and payload size errors safely before hitting route handlers
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: 'Request payload exceeds the 1MB limit.'
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

// Security: Account-level quota limiting for expensive AI operations (configurable, default 15 requests/hour)
const userHourlyQuota = parseInt(process.env.AI_HOURLY_QUOTA_PER_USER || '15', 10);
const aiUserQuotaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: userHourlyQuota,
  keyGenerator: (req: Request) => req.user?.userId || req.ip || 'anonymous',
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Account quota exceeded: You have reached the hourly limit for AI travel plan generations. Please try again later.'
  }
});

// Security: In-flight request deduplication lock to avoid duplicate parallel charges from rapid clicks
const activeAiUsers = new Set<string>();

function acquireAiLock(userId: string): boolean {
  if (activeAiUsers.has(userId)) {
    return false;
  }
  activeAiUsers.add(userId);
  return true;
}

function releaseAiLock(userId: string): void {
  activeAiUsers.delete(userId);
}

/**
 * Sanitizes server error messages to prevent accidental leakage of API keys or credentials in logs
 */
export function sanitizeLogMessage(input: any): string {
  if (typeof input !== 'string') {
    try {
      input = JSON.stringify(input);
    } catch {
      input = String(input);
    }
  }
  return input
    .replace(/((?:key|apiKey|password|secret|token|bearer|authorization)=)[^\s&"']+/gi, '$1REDACTED')
    .replace(/("(?:key|apiKey|password|secret|token|bearer|authorization)"\s*:\s*")[^"]+(")/gi, '$1REDACTED$2')
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1REDACTED$2');
}

// Health check endpoint (lightweight liveness probe for Docker and Render)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'AI Travel Agent API'
  });
});

// Safe database readiness check (safe boolean status without exposing internal schema, columns, or connection details)
app.get('/api/db-health', async (_req: Request, res: Response) => {
  const health = await checkDbHealth();
  const statusCode = health.success ? 200 : 503;
  res.status(statusCode).json({
    status: health.success ? 'ready' : 'unavailable',
    database: health.database
  });
});

// Authentication routes (Username/password authentication flow)
app.use('/api/auth', authRouter);

// Endpoint 1: Generate initial travel plan
app.post('/api/generate-travel-plan', requireAuth, aiRateLimiter, aiUserQuotaLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ authenticated: false });
    return;
  }

  if (!acquireAiLock(userId)) {
    res.status(429).json({
      success: false,
      error: 'A travel planning request is already being processed for your account. Please wait for it to finish.'
    });
    return;
  }

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
    let savedPlan: { id: string; createdAt: string } | null = null;
    if (result.plan) {
      try {
        savedPlan = await saveTravelPlan(userId, validation.data, result.plan);
      } catch (dbError: any) {
        console.error('[TravelPlan Save DB Error]:', sanitizeLogMessage(dbError?.message || dbError));
      }
    }

    res.json({
      success: true,
      data: result.plan,
      id: savedPlan?.id,
      createdAt: savedPlan?.createdAt,
      isDemo: result.isDemo,
      message: result.message || (result.isDemo
        ? 'Generated in demo mode. Provide GEMINI_API_KEY in server/.env for live AI generation.'
        : 'Plan generated successfully.')
    });
  } catch (error: any) {
    console.error('[Generate Plan Route Error]:', sanitizeLogMessage(error?.message || error));

    if (error?.name === 'DestinationAmbiguityError' || error?.isClientError) {
      res.status(400).json({
        success: false,
        error: error.message || 'The specified destination could not be uniquely identified.'
      });
      return;
    }

    res.status(502).json({
      success: false,
      error: 'Travel planning service is temporarily unable to generate your plan. Please check your inputs and try again.'
    });
  } finally {
    releaseAiLock(userId);
  }
});

// Endpoint 2: Modify existing travel plan
app.post('/api/modify-travel-plan', requireAuth, aiRateLimiter, aiUserQuotaLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ authenticated: false });
    return;
  }

  if (!acquireAiLock(userId)) {
    res.status(429).json({
      success: false,
      error: 'A travel planning modification is already in progress for your account. Please wait for it to finish.'
    });
    return;
  }

  try {
    const validation = validateModifyPlanRequest(req.body);
    if (!validation.isValid || !validation.data) {
      res.status(400).json({
        success: false,
        error: validation.error || 'Invalid travel plan modification request.'
      });
      return;
    }

    // If an itineraryId is provided, verify ownership before executing expensive AI operations
    if (validation.data.itineraryId) {
      const existing = await getTravelPlanByIdForUser(validation.data.itineraryId, userId);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'The saved itinerary you are modifying does not exist or does not belong to your account.'
        });
        return;
      }
    }

    const result = await modifyTravelPlanService(validation.data);

    // If modifying an existing saved itinerary, persist the updated plan to PostgreSQL
    let updateResult: { id: string; updatedAt: string } | null = null;
    if (validation.data.itineraryId && result.plan) {
      try {
        updateResult = await updateSavedTravelPlan(validation.data.itineraryId, userId, result.plan);
        if (!updateResult) {
          res.status(404).json({
            success: false,
            error: 'Failed to persist update: saved itinerary was not found or is unauthorized.'
          });
          return;
        }
      } catch (dbError: any) {
        console.error('[TravelPlan Modify DB Error]:', sanitizeLogMessage(dbError?.message || dbError));
        res.status(500).json({
          success: false,
          error: 'Failed to persist updated itinerary to database.'
        });
        return;
      }
    }

    res.json({
      success: true,
      data: result.plan,
      id: updateResult?.id,
      updatedAt: updateResult?.updatedAt,
      isDemo: result.isDemo,
      message: result.message || 'Plan updated successfully.'
    });
  } catch (error: any) {
    console.error('[Modify Plan Route Error]:', sanitizeLogMessage(error?.message || error));

    if (error?.name === 'DestinationAmbiguityError' || error?.isClientError) {
      res.status(400).json({
        success: false,
        error: error.message || 'The specified destination could not be uniquely identified.'
      });
      return;
    }

    res.status(502).json({
      success: false,
      error: 'Travel planning service is temporarily unable to update your plan. Please try again later.'
    });
  } finally {
    releaseAiLock(userId);
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

// Endpoint 5: Delete authenticated user's saved travel plan by ID
app.delete('/api/travel-plans/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
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

    const deleted = await deleteTravelPlanForUser(id, userId);
    if (!deleted) {
      res.status(404).json({
        error: 'Itinerary not found or unauthorized.'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Itinerary deleted successfully.'
    });
  } catch (error: any) {
    console.error('[Delete Travel Plan Route Error]:', error?.message || error);
    res.status(500).json({
      error: 'Unable to delete itinerary.'
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
  // Validate JWT configuration before accepting requests
  if (!isAuthConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Startup Fatal Error] JWT_SECRET is missing or does not meet security requirements (minimum 32 characters, non-predictable). Startup aborted.');
      process.exit(1);
    } else {
      console.warn('[Startup Warning] JWT_SECRET is missing or insecure in development. Please configure a strong secret in server/.env.');
    }
  }

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
    if (process.env.NODE_ENV === 'production') {
      console.error('[Startup Fatal Error] DATABASE_URL is strictly required in production environment. In-memory storage is disallowed.');
      process.exit(1);
    }
    console.log('[Notice] DATABASE_URL is not set. Local development mode enabled with isolated in-memory storage.');
  }

  const server = app.listen(PORT, () => {
    console.log(`AI Travel Agent server running on http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      console.log('Notice: GEMINI_API_KEY is not set in server/.env. Demo fallback mode is enabled.');
    } else {
      console.log('Gemini API key detected.');
    }

    console.log('OpenStreetMap discovery provider active (Nominatim + Overpass API). No paid maps API required.');
  });

  let isShuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Shutdown] Received ${signal}. Closing HTTP server...`);

    // Safety fallback: force exit after 10s if active sockets or queries hang
    const forceExitTimer = setTimeout(() => {
      console.warn('[Shutdown Warning] Forcing process exit after 10s shutdown timeout.');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    server.close(async () => {
      console.log('[Shutdown] HTTP server closed.');
      if (process.env.DATABASE_URL) {
        try {
          await pool.end();
          console.log('[Shutdown] Database connection pool closed successfully.');
        } catch (poolErr: any) {
          console.error('[Shutdown Error] Failed to close database pool:', poolErr?.message || poolErr);
        }
      }
      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

const isDirectExecution = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('index.js')
);

if (isDirectExecution) {
  startServer().catch((fatalErr) => {
    console.error('[Server Fatal Error]:', fatalErr?.message || fatalErr);
    process.exit(1);
  });
}
