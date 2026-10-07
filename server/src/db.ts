import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded (supporting running from server/ or project root)
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ override: false });

// Using DATABASE_URL environment variable (from Render or local .env)
const connectionString = process.env.DATABASE_URL;

const isRemoteOrProd = process.env.NODE_ENV === 'production' ||
  Boolean(connectionString && (connectionString.includes('render.com') || connectionString.includes('sslmode=require')));

export const pool = new Pool({
  connectionString,
  ssl: isRemoteOrProd ? { rejectUnauthorized: false } : undefined
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
