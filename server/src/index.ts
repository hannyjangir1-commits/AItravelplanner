import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { generateTravelPlanService, modifyTravelPlanService } from './aiService.js';
import { validateGeneratePlanRequest, validateModifyPlanRequest } from './validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BUG-02: Resolve .env path relative to __dirname (dist/index.js -> server/.env)
// This ensures server/.env is loaded correctly even when npm start is run from the project root.
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
// Secondary fallback: also attempt the current working directory .env (local dev / Docker)
dotenv.config({ override: false });

const app = express();
const PORT = process.env.PORT || 5000;

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
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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

// Endpoint 1: Generate initial travel plan
app.post('/api/generate-travel-plan', aiRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
app.post('/api/modify-travel-plan', aiRateLimiter, async (req: Request, res: Response): Promise<void> => {
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

app.listen(PORT, () => {
  console.log(`AI Travel Agent server running on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('Notice: GEMINI_API_KEY is not set in server/.env. Demo fallback mode is enabled.');
  } else {
    console.log('Gemini API key detected.');
  }
});
