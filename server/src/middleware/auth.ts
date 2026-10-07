import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken } from '../auth/jwt.js';
import { AuthenticatedUser } from '../types.js';

// Extend Express Request interface to include the authenticated user payload
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const AUTH_COOKIE_NAME = 'travelgenie_auth';

/**
 * Authentication middleware that verifies the application JWT stored in httpOnly cookie.
 * 
 * Behavior:
 * 1. Reads the travelgenie_auth cookie.
 * 2. If missing, invalid, or expired, safely returns HTTP 401 without crashing or leaking details.
 * 3. Never logs or exposes the JWT.
 * 4. Attaches verified user details to req.user and proceeds to the next handler.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = typeof req.cookies?.[AUTH_COOKIE_NAME] === 'string'
      ? req.cookies[AUTH_COOKIE_NAME]
      : null;

    if (!token) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const payload = verifyAuthToken(token);
    if (!payload || !payload.userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    req.user = {
      userId: payload.userId,
      username: payload.username
    };

    next();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown auth error';
    console.error('[Auth Middleware Error]:', errorMsg);
    res.status(500).json({
      authenticated: false,
      error: 'An unexpected internal error occurred.'
    });
  }
}

/**
 * Optional authentication middleware that checks the travelgenie_auth cookie.
 * 
 * Behavior:
 * 1. Reads the travelgenie_auth cookie if present.
 * 2. If valid and not expired, attaches verified user details to req.user.
 * 3. If missing, invalid, or expired, req.user remains undefined and execution continues normally.
 * 4. Never rejects requests or leaks errors.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = typeof req.cookies?.[AUTH_COOKIE_NAME] === 'string'
      ? req.cookies[AUTH_COOKIE_NAME]
      : null;

    if (token) {
      const payload = verifyAuthToken(token);
      if (payload && payload.userId) {
        req.user = {
          userId: payload.userId,
          username: payload.username
        };
      }
    }
  } catch (error) {
    // Silently continue for unauthenticated or malformed sessions
  }
  next();
}
