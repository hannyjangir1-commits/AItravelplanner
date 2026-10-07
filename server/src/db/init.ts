import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Finds the schema.sql file across common development and compiled directory layouts.
 */
function findSchemaSqlPath(): string | null {
  const candidatePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../src/db/schema.sql'),
    path.resolve(process.cwd(), 'dist/db/schema.sql'),
    path.resolve(process.cwd(), 'src/db/schema.sql'),
    path.resolve(process.cwd(), 'server/dist/db/schema.sql'),
    path.resolve(process.cwd(), 'server/src/db/schema.sql')
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Finds the migrations directory across common development and compiled directory layouts.
 */
function findMigrationsDirPath(): string | null {
  const candidatePaths = [
    path.resolve(__dirname, 'migrations'),
    path.resolve(__dirname, '../../src/db/migrations'),
    path.resolve(process.cwd(), 'dist/db/migrations'),
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(process.cwd(), 'server/dist/db/migrations'),
    path.resolve(process.cwd(), 'server/src/db/migrations')
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Core idempotent SQL migration statements guaranteed to run even in minimal Docker
 * or server environments where raw .sql files might not be on disk.
 */
const FALLBACK_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE,
    password_hash TEXT,
    google_id VARCHAR(255) UNIQUE,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    profile_picture TEXT,
    place VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS travel_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination VARCHAR(255) NOT NULL,
    number_of_days INTEGER NOT NULL,
    budget_inr NUMERIC NOT NULL,
    number_of_travellers INTEGER NOT NULL,
    interests JSONB NOT NULL,
    accommodation_preference VARCHAR(50) NOT NULL,
    activity_level VARCHAR(50) NOT NULL,
    additional_notes TEXT,
    plan_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent column additions for existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS place VARCHAR(255);

-- Idempotent index creation
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_travel_plans_user_id ON travel_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_travel_plans_created_at ON travel_plans(created_at DESC);
`;

/**
 * Automatically executed on server startup when DATABASE_URL is present.
 * Ensures the database schema is complete, valid, and up-to-date with all migrations.
 * Does NOT terminate the connection pool so the server can proceed normally.
 */
export async function runStartupMigrations(): Promise<{ success: boolean; message: string }> {
  if (!process.env.DATABASE_URL) {
    const msg = '[DB Startup] DATABASE_URL is not configured. Database migrations skipped.';
    console.log(msg);
    return { success: true, message: msg };
  }

  console.log('[DB Startup] Connecting to PostgreSQL to verify database schema and migrations...');

  let client;
  try {
    client = await pool.connect();
  } catch (connErr: any) {
    console.error('[DB Startup] Connection failed:', connErr?.message || connErr);
    return {
      success: false,
      message: `Database connection failed: ${connErr?.message || connErr}`
    };
  }

  try {
    await client.query('BEGIN');

    // 1. Check for schema.sql on disk or use embedded fallback
    const schemaPath = findSchemaSqlPath();
    if (schemaPath) {
      console.log(`[DB Startup] Applying SQL schema from file: ${schemaPath}`);
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      await client.query(schemaSql);
    } else {
      console.log('[DB Startup] Applying embedded core schema and migrations...');
      await client.query(FALLBACK_SCHEMA_SQL);
    }

    // 2. Check for disk migrations directory
    const migrationsDir = findMigrationsDirPath();
    if (migrationsDir) {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

      for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        console.log(`[DB Startup] Applying migration: ${file}`);
        const migrationSql = fs.readFileSync(filePath, 'utf-8');
        await client.query(migrationSql);
      }
    }

    // 3. Guarantee that username and password_hash columns exist on users
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS place VARCHAR(255);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);

    await client.query('COMMIT');
    console.log('[DB Startup] Schema and migrations applied successfully.');

    // 4. Verify columns in users table
    const colCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position;
    `);

    const userCols = colCheck.rows.map((r: { column_name: string }) => r.column_name);
    console.log('[DB Startup] Verified users table columns:', userCols.join(', '));

    const hasUsername = userCols.includes('username');
    const hasPasswordHash = userCols.includes('password_hash');

    if (!hasUsername || !hasPasswordHash) {
      console.error('[DB Startup Error] Missing required columns in users table!', {
        hasUsername,
        hasPasswordHash
      });
      return {
        success: false,
        message: 'Missing username or password_hash in users table.'
      };
    }

    return {
      success: true,
      message: `Database ready. Verified columns on users: ${userCols.join(', ')}`
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[DB Startup Migration Error]:', {
      message: err?.message,
      code: err?.code,
      detail: err?.detail
    });
    return {
      success: false,
      message: err?.message || String(err)
    };
  } finally {
    client.release();
  }
}

/**
 * Initializes the PostgreSQL database schema for TravelGenie.
 * Applies schema and migrations safely without dropping existing tables or data.
 * @param options.closePool If true, closes the pool upon completion (CLI mode).
 */
export async function initDatabase(options: { closePool?: boolean } = {}): Promise<{ success: boolean; message: string }> {
  try {
    return await runStartupMigrations();
  } finally {
    if (options.closePool) {
      await pool.end();
    }
  }
}

// Automatically execute if run directly via CLI (e.g. node dist/db/init.js or tsx src/db/init.ts)
const isDirectExecution = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  process.argv[1].endsWith('init.ts') ||
  process.argv[1].endsWith('init.js')
);

if (isDirectExecution) {
  initDatabase({ closePool: true })
    .then((result) => {
      if (!result.success && process.env.DATABASE_URL) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[DB Init Fatal Error]:', err);
      process.exit(1);
    });
}
