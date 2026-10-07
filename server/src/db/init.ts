import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Finds the schema.sql file across common development and compiled directory layouts.
 */
function findSchemaSqlPath(): string {
  const candidatePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../src/db/schema.sql'),
    path.resolve(process.cwd(), 'src/db/schema.sql'),
    path.resolve(process.cwd(), 'server/src/db/schema.sql')
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`schema.sql not found in candidate paths: ${candidatePaths.join(', ')}`);
}

/**
 * Finds the migrations directory across common development and compiled directory layouts.
 */
function findMigrationsDirPath(): string | null {
  const candidatePaths = [
    path.resolve(__dirname, 'migrations'),
    path.resolve(__dirname, '../../src/db/migrations'),
    path.resolve(process.cwd(), 'src/db/migrations'),
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
 * Initializes the PostgreSQL database schema for TravelGenie.
 * Applies schema.sql and migrations safely without dropping existing tables or data.
 */
export async function initDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('[DB Init] Starting TravelGenie database initialization...');

  if (!process.env.DATABASE_URL) {
    const msg = '[DB Init] DATABASE_URL is not configured. Schema execution skipped. To apply schema to a live database, set DATABASE_URL and run this script again.';
    console.warn(msg);
    return { success: false, message: msg };
  }

  const schemaPath = findSchemaSqlPath();
  console.log(`[DB Init] Reading SQL schema from: ${schemaPath}`);
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

  const migrationsDir = findMigrationsDirPath();

  try {
    const client = await pool.connect();
    try {
      console.log('[DB Init] Applying schema and migrations to PostgreSQL database...');
      await client.query('BEGIN');
      await client.query(schemaSql);

      // Apply any migration files in alphabetical order
      if (migrationsDir) {
        const migrationFiles = fs.readdirSync(migrationsDir)
          .filter((file) => file.endsWith('.sql'))
          .sort();

        for (const file of migrationFiles) {
          const filePath = path.join(migrationsDir, file);
          console.log(`[DB Init] Applying migration: ${file}`);
          const migrationSql = fs.readFileSync(filePath, 'utf-8');
          await client.query(migrationSql);
        }
      }

      await client.query('COMMIT');
      console.log('[DB Init] Schema and migrations executed successfully.');

      // Verification: Check if tables exist
      const tableCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('users', 'travel_plans')
        ORDER BY table_name;
      `);
      const existingTables = tableCheck.rows.map((r: { table_name: string }) => r.table_name);
      console.log(`[DB Init] Verified tables in database: ${existingTables.join(', ')}`);

      // Verification: Check columns on users table
      const columnCheck = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
        ORDER BY ordinal_position;
      `);
      console.log(`[DB Init] Verified users columns:`, columnCheck.rows.map((r: { column_name: string }) => r.column_name));

      // Verification: Check foreign keys
      const fkCheck = await client.query(`
        SELECT tc.constraint_name, tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'travel_plans';
      `);
      console.log(`[DB Init] Verified foreign keys on travel_plans:`, fkCheck.rows);

      // Verification: Check indexes
      const indexCheck = await client.query(`
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE tablename IN ('users', 'travel_plans')
        ORDER BY tablename, indexname;
      `);
      console.log(`[DB Init] Verified indexes:`, indexCheck.rows.map((r: { indexname: string; tablename: string }) => `${r.tablename}.${r.indexname}`));

      return {
        success: true,
        message: `Database initialized successfully. Verified tables: ${existingTables.join(', ')}`
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[DB Init] Failed to initialize database schema:', errorMsg);
    return { success: false, message: errorMsg };
  } finally {
    await pool.end();
  }
}

// Automatically execute if run directly via CLI (e.g. tsx src/db/init.ts)
const isDirectExecution = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  process.argv[1].endsWith('init.ts') ||
  process.argv[1].endsWith('init.js')
);

if (isDirectExecution) {
  initDatabase()
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
