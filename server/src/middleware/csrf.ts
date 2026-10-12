import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AUTH_COOKIE_NAME } from './auth.js';

export const CSRF_COOKIE_NAME = 'travelgenie_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generates a cryptographically strong 32-byte (64 hex char) anti-CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Checks whether an origin is in the allowed list of origins.
 */
export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/**
 * State-changing HTTP methods requiring CSRF validation for cookie-authenticated sessions.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * CSRF Protection Middleware
 * 
 * Implements the Double-Submit Cookie pattern with Origin verification for Defense-in-Depth:
 * 1. Automatically seeds or refreshes the travelgenie_csrf cookie on read requests.
 * 2. On state-changing requests authenticated via the session cookie (travelgenie_auth):
 *    - Validates that the request origin (if present) matches an allowed origin.
 *    - Validates that the X-CSRF-Token request header matches the travelgenie_csrf cookie using timingSafeEqual.
 *    - Rejects missing, invalid, or mismatched tokens with HTTP 403 Forbidden.
 * 3. Does not block unauthenticated login/signup or safe idempotent read methods.
 */
export function createCsrfMiddleware(getAllowedOrigins: () => string[]) {
  return function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    let existingToken = typeof req.cookies?.[CSRF_COOKIE_NAME] === 'string'
      ? req.cookies[CSRF_COOKIE_NAME]
      : null;

    // Seed CSRF cookie if absent or invalid format (expected 64 hex chars)
    if (!existingToken || existingToken.length !== 64) {
      existingToken = generateCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, existingToken, {
        httpOnly: false, // Must be readable by client JS to set X-CSRF-Token header
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });
    }

    // Attach CSRF token to response locals for easy access in handlers
    res.locals.csrfToken = existingToken;

    // Safe read-only HTTP methods do not require CSRF token validation
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    // Unauthenticated requests (no auth session cookie) do not have a session to forge
    const hasAuthCookie = Boolean(req.cookies?.[AUTH_COOKIE_NAME]);
    if (!hasAuthCookie) {
      next();
      return;
    }

    // 1. Origin verification for cookie-authenticated state-changing requests
    const originHeader = req.headers.origin;
    if (originHeader) {
      const allowedOrigins = getAllowedOrigins();
      if (!isAllowedOrigin(originHeader, allowedOrigins)) {
        res.status(403).json({
          success: false,
          error: 'Cross-origin request rejected. Untrusted origin.',
          code: 'FORBIDDEN_ORIGIN'
        });
        return;
      }
    }

    // 2. Token verification
    const headerToken = req.headers[CSRF_HEADER_NAME] || req.headers['x-csrf-token'];
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

    if (!headerToken || typeof headerToken !== 'string') {
      res.status(403).json({
        success: false,
        error: 'Missing CSRF token in request headers. Please include X-CSRF-Token.',
        code: 'EBADCSRFTOKEN'
      });
      return;
    }

    if (!cookieToken || typeof cookieToken !== 'string') {
      res.status(403).json({
        success: false,
        error: 'Missing CSRF cookie. Please refresh the page and try again.',
        code: 'EBADCSRFTOKEN'
      });
      return;
    }

    if (headerToken.length !== cookieToken.length) {
      res.status(403).json({
        success: false,
        error: 'Invalid CSRF token.',
        code: 'EBADCSRFTOKEN'
      });
      return;
    }

    try {
      const headerBuffer = Buffer.from(headerToken, 'utf-8');
      const cookieBuffer = Buffer.from(cookieToken, 'utf-8');
      const isValid = crypto.timingSafeEqual(headerBuffer, cookieBuffer);

      if (!isValid) {
        res.status(403).json({
          success: false,
          error: 'Invalid CSRF token.',
          code: 'EBADCSRFTOKEN'
        });
        return;
      }
    } catch {
      res.status(403).json({
        success: false,
        error: 'Invalid CSRF token.',
        code: 'EBADCSRFTOKEN'
      });
      return;
    }

    next();
  };
}

/**
 * Controller endpoint to retrieve or refresh the CSRF token.
 */
export function getCsrfTokenEndpoint(req: Request, res: Response): void {
  let token = typeof req.cookies?.[CSRF_COOKIE_NAME] === 'string'
    ? req.cookies[CSRF_COOKIE_NAME]
    : null;

  if (!token || token.length !== 64) {
    token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
  }

  res.json({
    csrfToken: token
  });
}
