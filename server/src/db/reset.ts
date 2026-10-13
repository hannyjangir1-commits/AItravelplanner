import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, extractDatabaseHost, logSafeDbDiagnostics } from '../db.js';
import { checkDbHealth } from './init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ResetDatabaseResult {
  success: boolean;
  message: string;
  targetHost?: string;
  tablesCreated?: string[];
}

/**
 * Finds the schema.sql file across common development and compiled directory layouts.
 */
function findSchemaSqlPath(): string | null {
  const candidatePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, 'db/schema.sql'),
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
 * Performs a deliberate, authorized, complete reset of the TravelGenie PostgreSQL database schema.
 *
 * SAFETY REQUIREMENTS:
 * 1. Strictly requires process.env.ALLOW_DESTRUCTIVE_SCHEMA_RESET === 'true'.
 * 2. Validates DATABASE_URL exists and parses target hostname safely without printing credentials.
 * 3. Acquires PostgreSQL advisory lock before executing any DDL.
 * 4. Executes clean wipe (DROP TABLE CASCADE) and fresh schema creation within a transaction.
 * 5. Seeds the initial migration record into schema_migrations.
 * 6. Validates table existence and schema health before releasing lock and returning.
 */
export async function resetDatabase(): Promise<ResetDatabaseResult> {
  // 1. Explicit Authorization Guard
  if (process.env.ALLOW_DESTRUCTIVE_SCHEMA_RESET?.trim() !== 'true') {
    const refusal = '[DB Reset Refusal] Destructive schema reset is strictly disallowed without explicit authorization. Set ALLOW_DESTRUCTIVE_SCHEMA_RESET=true in the execution environment to proceed.';
    console.error(refusal);
    return {
      success: false,
      message: refusal
    };
  }

  // 2. Validate Target Environment
  if (!process.env.DATABASE_URL) {
    const errorMsg = '[DB Reset Error] DATABASE_URL is not configured. Reset operation cannot proceed.';
    console.error(errorMsg);
    return {
      success: false,
      message: errorMsg
    };
  }

  const targetHost = extractDatabaseHost(process.env.DATABASE_URL) || 'unknown';
  logSafeDbDiagnostics('[SharedPool:resetDatabase]');
  console.log(`[DB Reset] Initiating complete schema reset on target host: ${targetHost}...`);

  const MIGRATION_ADVISORY_LOCK_ID = 84729104;
  let client: any = null;
  let lockAcquired = false;

  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = true;

    await client.query('BEGIN');

    // 3. Drop existing application tables in dependency order
    console.log('[DB Reset] Dropping existing application tables (travel_plans, users, schema_migrations)...');
    await client.query('DROP TABLE IF EXISTS travel_plans CASCADE;');
    await client.query('DROP TABLE IF EXISTS users CASCADE;');
    await client.query('DROP TABLE IF EXISTS schema_migrations CASCADE;');

    // 4. Load fresh schema.sql
    const schemaPath = findSchemaSqlPath();
    if (!schemaPath) {
      throw new Error('[DB Reset Fatal Error] schema.sql could not be found in any candidate directory.');
    }

    console.log(`[DB Reset] Applying fresh schema from: ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    await client.query(schemaSql);

    // 5. Seed migration tracking record for 001_initial_relational_schema
    await client.query(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (version) DO NOTHING;
    `, ['001', '001_initial_relational_schema.sql']);

    await client.query('COMMIT');
    console.log('[DB Reset] Clean schema created and initial migration recorded successfully.');

    // 6. Verify table creation in information_schema
    const tableRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    const tables = tableRes.rows.map((r: { table_name: string }) => r.table_name);
    console.log('[DB Reset] Verified active public tables:', tables.join(', '));

    const expectedTables = ['users', 'travel_plans', 'schema_migrations'];
    for (const exp of expectedTables) {
      if (!tables.includes(exp)) {
        throw new Error(`[DB Reset Verification Error] Expected table "${exp}" was not found after schema creation.`);
      }
    }

    // 7. Health check validation
    const health = await checkDbHealth();
    if (!health.success) {
      throw new Error('[DB Reset Verification Error] Post-reset database health check failed.');
    }

    return {
      success: true,
      message: `Database schema reset completed successfully on host "${targetHost}". Active tables: ${tables.join(', ')}`,
      targetHost,
      tablesCreated: tables
    };
  } catch (err: any) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    const sanitizedError = err?.message || String(err);
    console.error('[DB Reset Fatal Error]:', sanitizedError);
    return {
      success: false,
      message: sanitizedError,
      targetHost
    };
  } finally {
    if (client) {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]).catch(() => {});
      }
      client.release();
    }
  }
}

// CLI execution handling
const isDirectExecution = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  process.argv[1].endsWith('reset.ts') ||
  process.argv[1].endsWith('reset.js')
);

if (isDirectExecution) {
  resetDatabase()
    .then(async (result) => {
      await pool.end();
      if (!result.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[DB Reset Uncaught Error]:', err?.message || err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
