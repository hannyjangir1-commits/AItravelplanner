import { Request, Response, NextFunction } from 'express';
import { sanitizeLogMessage } from './security.js';

export function unhandledErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[Unhandled Global Server Error]:', sanitizeLogMessage(err?.message || err));
  res.status(err.status || 500).json({
    success: false,
    error: 'An internal server error occurred. Please try again later.'
  });
}
