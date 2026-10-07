import jwt from 'jsonwebtoken';
import { getAuthConfig } from './config.js';

export interface AuthenticatedUserPayload {
  userId: string;
  email: string | null;
  name: string | null;
  profilePicture: string | null;
}

const JWT_EXPIRATION = '7d';

/**
 * Signs an authenticated user payload into a secure JWT.
 * Expiration is set to 7 days.
 * Payload contains only minimal identity fields (userId, email, name, profilePicture).
 * Never contains Google access tokens or secrets.
 */
export function signAuthToken(payload: AuthenticatedUserPayload): string {
  const { jwtSecret } = getAuthConfig();
  return jwt.sign(
    {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      profilePicture: payload.profilePicture
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
      email: typeof decoded.email === 'string' ? decoded.email : null,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      profilePicture: typeof decoded.profilePicture === 'string' ? decoded.profilePicture : null
    };
  } catch {
    // Safely reject invalid/expired/tampered tokens without leaking internal errors
    return null;
  }
}
