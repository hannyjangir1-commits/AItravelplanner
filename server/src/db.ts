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

// Using DATABASE_URL environment variable (from Render or local .env)
const connectionString = process.env.DATABASE_URL;

/**
 * Builds the database TLS configuration with strict certificate validation.
 * - In production, strict certificate validation (rejectUnauthorized: true) is mandatory.
 * - Node.js validates standard cloud PostgreSQL certificates (Render, Neon, Supabase) via the root CA store.
 * - Supports custom CA certificates via DB_CA_CERT (inline PEM) or PGSSLROOTCERT (file path).
 * - Preserves plain TCP connections for local development (127.0.0.1 / localhost) unless DATABASE_SSL=true.
 */
export function getDatabaseSslConfig(): pg.ConnectionConfig['ssl'] {
  const isProd = process.env.NODE_ENV === 'production';
  const connectionStr = process.env.DATABASE_URL || '';
  const explicitSsl = process.env.DATABASE_SSL;
  const isLocalHost = connectionStr.includes('localhost') || connectionStr.includes('127.0.0.1');

  // Local development without explicit SSL does not use TLS
  if (!isProd && isLocalHost && explicitSsl !== 'true') {
    return undefined;
  }

  const requiresSsl = isProd || explicitSsl === 'true' || connectionStr.includes('sslmode=') || connectionStr.includes('render.com');
  if (!requiresSsl) {
    return undefined;
  }

  const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
    rejectUnauthorized: true
  };

  if (process.env.DB_CA_CERT) {
    sslConfig.ca = process.env.DB_CA_CERT;
  } else if (process.env.PGSSLROOTCERT && fs.existsSync(process.env.PGSSLROOTCERT)) {
    try {
      sslConfig.ca = fs.readFileSync(process.env.PGSSLROOTCERT, 'utf-8');
    } catch (err: any) {
      console.error('[DB SSL Warning] Could not read custom root CA cert:', err?.message);
    }
  }

  return sslConfig;
}

export const pool = new Pool({
  connectionString,
  ssl: getDatabaseSslConfig()
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
