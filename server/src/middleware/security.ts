import { Request, Response, NextFunction } from 'express';

/**
 * Standard HTTP security headers with strict CSP and conditional HSTS.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy for React SPA, Google Fonts, and secure assets
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', cspDirectives);

  // Strict-Transport-Security: Only when confirmed HTTPS in production
  if (process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * Handles JSON body parsing errors (entity.too.large, SyntaxError).
 */
export function jsonParsingErrorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (err.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: 'Request payload exceeds the 1MB limit.'
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      success: false,
      error: 'Malformed JSON payload. Please ensure the request body is valid JSON.'
    });
    return;
  }
  next(err);
}

/**
 * Sanitizes server error messages to prevent accidental leakage of API keys or credentials in logs.
 */
export function sanitizeLogMessage(input: any): string {
  if (typeof input !== 'string') {
    try {
      input = JSON.stringify(input);
    } catch {
      input = String(input);
    }
  }
  return input
    .replace(/((?:key|apiKey|password|secret|token|bearer|authorization)=)[^\s&"']+/gi, '$1REDACTED')
    .replace(/("(?:key|apiKey|password|secret|token|bearer|authorization)"\s*:\s*")[^"]+(")/gi, '$1REDACTED$2')
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1REDACTED$2');
}
