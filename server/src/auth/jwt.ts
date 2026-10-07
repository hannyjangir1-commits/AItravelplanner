import jwt from 'jsonwebtoken';
import { getAuthConfig } from './config.js';

export interface AuthenticatedUserPayload {
  userId: string;
  username: string;
}

const JWT_EXPIRATION = '7d';

/**
 * Signs an authenticated user payload into a secure JWT.
 * Expiration is set to 7 days.
 * Payload contains minimal identity fields (userId, username).
 */
export function signAuthToken(payload: AuthenticatedUserPayload): string {
  const { jwtSecret } = getAuthConfig();
  return jwt.sign(
    {
      userId: payload.userId,
      username: payload.username
    },
    jwtSecret,
    { expiresIn: JWT_EXPIRATION }
  );
}

/**
 * Verifies a JWT and returns the decoded authenticated user payload.
 * Returns null safely if the token is invalid, expired, or malformed.
 */
export function verifyAuthToken(token: string): AuthenticatedUserPayload | null {
  try {
    const { jwtSecret } = getAuthConfig();
    const decoded = jwt.verify(token, jwtSecret) as Partial<AuthenticatedUserPayload>;

    if (!decoded || typeof decoded.userId !== 'string') {
      return null;
    }

    return {
      userId: decoded.userId,
      username: typeof decoded.username === 'string' ? decoded.username : ''
    };
  } catch {
    return null;
  }
}
