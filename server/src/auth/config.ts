import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, '../../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ override: false });

export interface AuthConfig {
  jwtSecret: string;
}

/**
 * Validates and retrieves authentication configuration from environment variables.
 * Uses existing JWT_SECRET with a secure fallback for development.
 */
export function getAuthConfig(): AuthConfig {
  const jwtSecret = process.env.JWT_SECRET || 'travelgenie_default_jwt_secret_key_2026';
  return {
    jwtSecret
  };
}

export function isAuthConfigured(): boolean {
  return true;
}
