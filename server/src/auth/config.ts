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

const INSECURE_DEFAULTS = new Set([
  'travelgenie_default_jwt_secret_key_2026',
  'secret',
  'jwt_secret',
  'changeme',
  'default_secret',
  'password',
  '12345678901234567890123456789012'
]);

/**
 * Validates the JWT_SECRET without exposing secret content.
 */
export function validateJwtSecret(secret?: string): { isValid: boolean; error?: string } {
  if (!secret || typeof secret !== 'string') {
    return {
      isValid: false,
      error: 'JWT_SECRET environment variable is missing or empty.'
    };
  }

  const trimmed = secret.trim();
  if (trimmed.length < 32) {
    return {
      isValid: false,
      error: `JWT_SECRET is too short (${trimmed.length} chars). A minimum of 32 characters is required for HS256.`
    };
  }

  if (INSECURE_DEFAULTS.has(trimmed.toLowerCase())) {
    return {
      isValid: false,
      error: 'JWT_SECRET is set to a known, predictable default value. Please configure a unique cryptographically strong secret.'
    };
  }

  return { isValid: true };
}

/**
 * Checks whether a valid, secure JWT secret is configured in the environment.
 */
export function isAuthConfigured(): boolean {
  return validateJwtSecret(process.env.JWT_SECRET).isValid;
}

/**
 * Validates and retrieves authentication configuration from environment variables.
 * Throws a descriptive error if the secret is missing or insecure.
 * Never prints or leaks the secret value.
 */
export function getAuthConfig(): AuthConfig {
  const validation = validateJwtSecret(process.env.JWT_SECRET);
  if (!validation.isValid) {
    throw new Error(`[Auth Configuration Error] ${validation.error}`);
  }

  return {
    jwtSecret: process.env.JWT_SECRET!.trim()
  };
}
