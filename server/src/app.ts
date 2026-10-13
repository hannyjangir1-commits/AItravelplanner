import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import compression from 'compression';
import cookieParser from 'cookie-parser';

// Resolve IPv4 first to prevent connection timeouts on Windows environments without public IPv6 routing
dns.setDefaultResultOrder('ipv4first');

import { securityHeaders, jsonParsingErrorHandler, sanitizeLogMessage } from './middleware/security.js';
import { corsMiddleware, getAllowedOrigins } from './middleware/cors.js';
import { createCsrfMiddleware } from './middleware/csrf.js';
import { unhandledErrorHandler } from './middleware/errorHandler.js';

import authRouter from './routes/auth.js';
import plansRouter from './routes/plans.js';
import itinerariesRouter from './routes/itineraries.js';
import healthRouter from './routes/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Enable trust proxy for Render reverse proxy HTTPS detection and secure cookies
app.set('trust proxy', 1);

// Security: Disable Express fingerprinting header
app.disable('x-powered-by');

// Performance: Gzip/Deflate compression for API JSON responses and static assets
app.use(compression());

// Security: Standard HTTP security headers with strict CSP and conditional HSTS
app.use(securityHeaders);

// Serve React static files in production
export const clientDistPath = process.env.CLIENT_DIST_PATH || path.resolve(__dirname, '../../client/dist');
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

// Security: Strict CORS policy
app.use(corsMiddleware);

// Cookie parsing middleware for authenticated sessions
app.use(cookieParser());

// Security: Anti-CSRF protection for state-changing requests on authenticated sessions
app.use(createCsrfMiddleware(getAllowedOrigins));

// Security: Enforce explicit 1mb body size limit to accommodate travel plans with verified place catalogs
app.use(express.json({ limit: '1mb' }));

// Handle malformed JSON and payload size errors safely before hitting route handlers
app.use(jsonParsingErrorHandler);

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api', plansRouter);
app.use('/api', itinerariesRouter);
app.use('/api', healthRouter);

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
app.use(unhandledErrorHandler);
