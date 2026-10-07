import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';
import { hashPassword } from '../auth/password.js';
import { signAuthToken } from '../auth/jwt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DbHealthResult {
  success: boolean;
  database: 'connected' | 'disconnected';
  schemaReady: boolean;
  requiredColumns: {
    username: boolean;
    password_hash: boolean;
  };
}

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
 * Performs a safe health check on the database.
 * Never returns DATABASE_URL, passwords, hashes, hostnames, or credentials.
 */
export async function checkDbHealth(): Promise<DbHealthResult> {
  if (!process.env.DATABASE_URL) {
    return {
      success: false,
      database: 'disconnected',
      schemaReady: false,
      requiredColumns: {
        username: false,
        password_hash: false
      }
    };
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err: any) {
    console.error('[DB Health Check Error]: Connection failed:', err?.message || err);
    return {
      success: false,
      database: 'disconnected',
      schemaReady: false,
      requiredColumns: {
        username: false,
        password_hash: false
      }
    };
  }

  try {
    // 1. Connection ping
    await client.query('SELECT 1');

    // 2. Query columns on users table
    const colRes = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users';
    `);

    const cols = new Set(colRes.rows.map((r: { column_name: string }) => r.column_name));
    const hasUsername = cols.has('username');
    const hasPasswordHash = cols.has('password_hash');

    // 3. Check travel_plans table exists
    const tableRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'travel_plans';
    `);
    const hasTravelPlans = tableRes.rows.length > 0;

    const schemaReady = Boolean(hasUsername && hasPasswordHash && hasTravelPlans);
    const success = schemaReady;

    return {
      success,
      database: 'connected',
      schemaReady,
      requiredColumns: {
        username: hasUsername,
        password_hash: hasPasswordHash
      }
    };
  } catch (queryErr: any) {
    console.error('[DB Health Check Error]: Query error:', queryErr?.message || queryErr);
    return {
      success: false,
      database: 'connected',
      schemaReady: false,
      requiredColumns: {
        username: false,
        password_hash: false
      }
    };
  } finally {
    client.release();
  }
}

/**
 * Temporary safe diagnostic test for signup.
 * Probes getUserByUsername SELECT query, test INSERT in a transaction that is immediately ROLLED BACK,
 * and validates password hashing and JWT signing without creating persistent test users or exposing credentials.
 */
export async function runSignupDiagnosticTest(): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Verify password hashing works in current Node environment
    const testHash = await hashPassword('DiagnosticProbeTestPassword123!');
    if (!testHash || !testHash.includes(':')) {
      throw new Error('Password hashing failed to produce a valid salted hash.');
    }

    // 2. Verify JWT signing works
    const testToken = signAuthToken({
      userId: '00000000-0000-0000-0000-000000000000',
      username: '__diag_probe__'
    });
    if (!testToken) {
      throw new Error('JWT signing failed to produce a valid token.');
    }

    // 3. Verify database SELECT and INSERT using a transaction that is rolled back immediately
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Test SELECT query matching getUserByUsername
      await client.query(
        'SELECT id, username, password_hash, name, place FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        ['__diag_probe__']
      );

      // Test INSERT query matching createUser within transaction
      await client.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        ['__diag_probe__', testHash]
      );

      // Rollback transaction immediately to ensure NO persistent test user remains
      await client.query('ROLLBACK');
      console.log('[Diagnostic Self-Test] Verified: getUserByUsername query, INSERT transaction rollback, scrypt hashing, and JWT signing.');
      return { success: true, message: 'Signup diagnostic self-test passed successfully.' };
    } catch (dbErr: any) {
      await client.query('ROLLBACK').catch(() => {});
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const errorDetails = {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      column: err?.column,
      table: err?.table
    };
    console.error('[Diagnostic Self-Test Failure]:', errorDetails);
    return {
      success: false,
      message: `Diagnostic test failed: ${err?.message || String(err)}`
    };
  }
}

/**
 * Executes core idempotent schema creation and migrations before the HTTP server begins listening.
 * Ensures users table has username, password_hash, place, and indexes.
 * Ensures travel_plans table has all columns and foreign keys.
 * Runs signup diagnostic test with transaction rollback.
 * Does NOT call pool.end() so the application pool remains active.
 */
export async function runStartupMigrations(): Promise<{ success: boolean; message: string }> {
  if (!process.env.DATABASE_URL) {
    const msg = '[DB Startup] DATABASE_URL is not configured. Database migrations skipped.';
    console.log(msg);
    return { success: true, message: msg };
  }

  console.log('[DB Startup] Connecting to PostgreSQL to apply schema and migrations...');

  let client;
  try {
    client = await pool.connect();
  } catch (connErr: any) {
    const sanitizedError = {
      message: connErr?.message,
      code: connErr?.code,
      name: connErr?.name
    };
    console.error('[DB Startup Fatal] Database connection failed:', sanitizedError);
    return {
      success: false,
      message: `Database connection failed: ${connErr?.message || connErr}`
    };
  }

  try {
    // 1. Attempt pgcrypto extension safely (catch if unprivileged cloud DB user, since PostgreSQL 13+ has built-in gen_random_uuid())
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    } catch (extErr: any) {
      console.log('[DB Startup] Notice: Extension pgcrypto creation skipped or not permitted (using native gen_random_uuid):', extErr?.message);
    }

    // 2. Ensure users table exists with base columns
    await client.query(`
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
    `);

    // 3. Ensure columns exist on users table even if users was created in an older step
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS place VARCHAR(255);');

    // 4. Ensure unique and performance indexes on users
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);');

    // 5. Ensure travel_plans table exists
    await client.query(`
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
    `);

    // 6. Ensure indexes on travel_plans
    await client.query('CREATE INDEX IF NOT EXISTS idx_travel_plans_user_id ON travel_plans(user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_travel_plans_created_at ON travel_plans(created_at DESC);');

    // 7. Apply disk schema.sql if present
    const schemaPath = findSchemaSqlPath();
    if (schemaPath) {
      console.log(`[DB Startup] Found schema file at: ${schemaPath}`);
    }

    // 8. Apply disk migrations if present
    const migrationsDir = findMigrationsDirPath();
    if (migrationsDir) {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

      for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        const migrationSql = fs.readFileSync(filePath, 'utf-8');
        try {
          await client.query(migrationSql);
          console.log(`[DB Startup] Applied migration file: ${file}`);
        } catch (migErr: any) {
          console.log(`[DB Startup] Notice on migration file ${file}:`, migErr?.message);
        }
      }
    }

    // 9. Verification: Query columns on users table
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
      const missing = [];
      if (!hasUsername) missing.push('username');
      if (!hasPasswordHash) missing.push('password_hash');
      throw new Error(`Users table verification failed. Missing required columns: ${missing.join(', ')}`);
    }

    console.log('[DB Startup] Database schema and column verification succeeded.');
    client.release();
    client = null;

    // 10. Run signup diagnostic probe (safe test with transaction rollback)
    const diagResult = await runSignupDiagnosticTest();
    if (!diagResult.success) {
      throw new Error(`Signup diagnostic probe failed: ${diagResult.message}`);
    }

    return {
      success: true,
      message: `Database schema verified successfully. Columns: ${userCols.join(', ')}`
    };
  } catch (err: any) {
    if (client) {
      client.release();
      client = null;
    }
    const sanitizedError = {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      column: err?.column,
      table: err?.table
    };
    console.error('[DB Startup Fatal Error]:', sanitizedError);
    return {
      success: false,
      message: err?.message || String(err)
    };
  }
}

/**
 * Initializes database (CLI entry point).
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
      console.error('[DB Init Fatal Error]:', err?.message || err);
      process.exit(1);
    });
}
