import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

// Resolve IPv4 first to prevent connection timeouts on Windows environments without public IPv6 routing
dns.setDefaultResultOrder('ipv4first');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BUG-02: Resolve .env path relative to __dirname (dist/index.js -> server/.env)
// This ensures server/.env is loaded correctly even when npm start is run from the project root.
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
// Secondary fallback: also attempt the current working directory .env (local dev / Docker)
dotenv.config({ override: false });

import { app } from './app.js';
import { pool } from './db.js';
import { runStartupMigrations } from './db/init.js';
import { isAuthConfigured } from './auth/config.js';

// Backward-compatible exports required by test suites
export { app } from './app.js';
export { getAllowedOrigins } from './middleware/cors.js';
export { sanitizeLogMessage } from './middleware/security.js';

const PORT = process.env.PORT || 5000;

export async function startServer(): Promise<any> {
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

  return server;
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
