import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded (supporting running from server/ or project root)
dotenv.config({ path: path.resolve(__dirname, '../../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ override: false });

export interface AuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
  jwtSecret: string;
}

/**
 * Validates and retrieves authentication configuration from environment variables.
 * Fails clearly if any required configuration is missing when called.
 * Never hardcodes or logs secrets.
 */
export function getAuthConfig(): AuthConfig {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL;
  const jwtSecret = process.env.JWT_SECRET;

  const missing: string[] = [];
  if (!googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (!googleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!googleCallbackUrl) missing.push('GOOGLE_CALLBACK_URL');
  if (!jwtSecret) missing.push('JWT_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `[Auth Configuration Error] Missing required authentication environment variables: ${missing.join(', ')}. ` +
      'Please ensure these variables are defined in your environment or server/.env file.'
    );
  }

  return {
    googleClientId: googleClientId as string,
    googleClientSecret: googleClientSecret as string,
    googleCallbackUrl: googleCallbackUrl as string,
    jwtSecret: jwtSecret as string
  };
}

/**
 * Returns whether all required authentication environment variables are present.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL &&
    process.env.JWT_SECRET
  );
}
