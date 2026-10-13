import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

import fs from 'fs';
import type pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded (supporting running from server/ or project root)
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ override: false });

/**
 * Extracts host from connection string safely without exposing credentials.
 */
export function extractDatabaseHost(connectionStr?: string): string | null {
  if (!connectionStr) return null;
  try {
    const url = new URL(connectionStr);
    return url.hostname || null;
  } catch {
    const match = connectionStr.match(/@([^:/]+)/) || connectionStr.match(/host=([^\s]+)/);
    return match ? match[1] : null;
  }
}

/**
 * Checks whether a database host is on an internal network or local environment:
 * - Localhost / 127.0.0.1 / ::1
 * - Render internal database host (e.g. starts with "dpg-" and does not end in ".render.com")
 * - Hostnames ending with ".internal", ".local", or single-label hostnames without dots (e.g. Docker service name)
 */
export function isInternalDatabaseHost(host?: string | null): boolean {
  if (!host) return false;
  const clean = host.trim().toLowerCase();
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1') {
    return true;
  }
  if (clean.endsWith('.render.com')) {
    return false;
  }
  if (clean.startsWith('dpg-')) {
    return true;
  }
  if (clean.endsWith('.internal') || clean.endsWith('.local')) {
    return true;
  }
  if (!clean.includes('.')) {
    return true;
  }
  return false;
}

/**
 * Builds the database TLS configuration with strict security guarantees:
 *
 * 1. Render Internal PostgreSQL Connection Mode (Opt-In):
 *    - Render's managed PostgreSQL database within the same private network (VPC) provides an
 *      Internal Database URL (e.g. postgresql://user:pass@dpg-cxxxx-a:5432/dbname).
 *    - Because Render's internal PostgreSQL instance serves a self-signed certificate, verifying
 *      it against the public CA store causes DEPTH_ZERO_SELF_SIGNED_CERT.
 *    - To support this, operators explicitly opt in with DATABASE_SSL=false.
 *    - Disabling TLS via DATABASE_SSL=false is strictly permitted ONLY for local development or
 *      internal database URLs on the private network.
 *    - It returns ssl: false and sanitizes the connection string so pg does not inherit conflicting parameters.
 *
 * 2. External PostgreSQL Connections:
 *    - All external connections in production (e.g. *.render.com, *.neon.tech, *.supabase.co) MUST use TLS.
 *    - If DATABASE_SSL=false is attempted for an external production connection, startup halts with a clear error.
 *    - Certificate verification is strictly enforced with rejectUnauthorized: true.
 *    - Under no circumstances is rejectUnauthorized: false ever used as a workaround.
 *
 * 3. Local Development:
 *    - Local development connections (127.0.0.1 / localhost) use plain TCP (ssl: undefined) unless DATABASE_SSL=true.
 */
export function getDatabaseSslConfig(): pg.ConnectionConfig['ssl'] {
  const isProd = process.env.NODE_ENV === 'production';
  const connectionStr = process.env.DATABASE_URL || '';
  const rawExplicitSsl = process.env.DATABASE_SSL;
  const explicitSsl = (rawExplicitSsl !== undefined && rawExplicitSsl !== 'undefined' && rawExplicitSsl.trim() !== '')
    ? rawExplicitSsl.trim().toLowerCase()
    : undefined;

  // Validate DATABASE_SSL parameter value
  if (explicitSsl !== undefined && explicitSsl !== 'true' && explicitSsl !== 'false') {
    throw new Error(`[Database Configuration Error] Invalid DATABASE_SSL value "${rawExplicitSsl}". Permitted values are "true" or "false".`);
  }

  const rawCaCert = process.env.DB_CA_CERT;
  const caCert = (rawCaCert !== undefined && rawCaCert !== 'undefined' && rawCaCert.trim() !== '') ? rawCaCert : undefined;
  const rawRootCert = process.env.PGSSLROOTCERT;
  const rootCert = (rawRootCert !== undefined && rawRootCert !== 'undefined' && rawRootCert.trim() !== '') ? rawRootCert : undefined;

  // Conflict check: custom CA certificate cannot be provided alongside DATABASE_SSL=false
  if (explicitSsl === 'false' && (caCert || rootCert)) {
    throw new Error('[Database Configuration Error] Conflicting configuration: DB_CA_CERT or PGSSLROOTCERT was provided while DATABASE_SSL=false is set.');
  }

  const host = extractDatabaseHost(connectionStr);
  const isInternal = isInternalDatabaseHost(host) || process.env.RENDER_INTERNAL_DB === 'true' || process.env.DATABASE_INTERNAL === 'true';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  // Handling DATABASE_SSL=false
  if (explicitSsl === 'false') {
    // In production, DATABASE_SSL=false is ONLY permitted for internal private network or localhost connections
    if (isProd && !isInternal) {
      throw new Error('[Database Configuration Error] Disabling TLS (DATABASE_SSL=false) is strictly prohibited for external database connections in production. External connections must use TLS with strict certificate verification.');
    }
    return false;
  }

  // Local development without explicit DATABASE_SSL=true does not use TLS
  if (!isProd && isLocalHost && explicitSsl !== 'true') {
    return undefined;
  }

  if (isProd && !connectionStr) {
    throw new Error('[Database Configuration Error] DATABASE_URL environment variable is required in production.');
  }

  // In production (or if DATABASE_SSL=true or connection explicitly specifies SSL), enforce TLS with strict verification
  const requiresSsl = isProd || explicitSsl === 'true' || connectionStr.includes('sslmode=') || connectionStr.includes('render.com');
  if (!requiresSsl) {
    return undefined;
  }

  const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
    rejectUnauthorized: true
  };

  if (caCert) {
    sslConfig.ca = caCert;
  } else if (rootCert && fs.existsSync(rootCert)) {
    try {
      sslConfig.ca = fs.readFileSync(rootCert, 'utf-8');
    } catch (err: any) {
      console.error('[DB SSL Warning] Could not read custom root CA cert:', err?.message);
    }
  }

  return sslConfig;
}

/**
 * Sanitizes the database connection string before passing to pg.Pool.
 *
 * If TLS is disabled (sslConfig === false), any conflicting SSL query parameters
 * (such as sslmode=require, ssl=true, etc.) are stripped from the connection string so that
 * pg-connection-string does not override the pool's ssl: false setting.
 * Never prints credentials, passwords, or the raw connection string in logs.
 */
export function sanitizeDatabaseUrl(rawUrl?: string, sslConfig?: pg.ConnectionConfig['ssl']): string | undefined {
  if (!rawUrl) return rawUrl;

  if (sslConfig === false) {
    try {
      const parsed = new URL(rawUrl);
      let modified = false;
      const sslParams = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey'];
      for (const param of sslParams) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.delete(param);
          modified = true;
        }
      }
      if (modified) {
        console.log('[DB Startup] Note: Removed conflicting SSL query parameters from internal database URL to honor DATABASE_SSL=false.');
      }
      return modified ? parsed.toString() : rawUrl;
    } catch {
      return rawUrl
        .replace(/([?&])sslmode=[^&]+(&|$)/g, '$1')
        .replace(/([?&])ssl=[^&]+(&|$)/g, '$1')
        .replace(/[?&]$/, '');
    }
  }

  return rawUrl;
}

// Initialized pool using sanitized connection string and strict SSL configuration
const sslConfig = getDatabaseSslConfig();
const connectionString = sanitizeDatabaseUrl(process.env.DATABASE_URL, sslConfig);

export const pool = new Pool({
  connectionString,
  ssl: sslConfig
});

// Handle idle connection errors gracefully without crashing the Node.js process
pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Idle Client Error]:', err?.message || err);
});

/**
 * Executes a simple query to verify database connectivity.
 * @returns true if connected successfully, false otherwise.
 */
export async function testDbConnection(): Promise<boolean> {
  if (!connectionString) {
    console.warn('[DB] DATABASE_URL is not set. Skipping connection test.');
    return false;
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT NOW()');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[DB] Connection test failed:', error instanceof Error ? error.message : error);
    return false;
  }
}
