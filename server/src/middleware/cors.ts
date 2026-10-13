import cors from 'cors';

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
export const corsMiddleware = cors({
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
});
