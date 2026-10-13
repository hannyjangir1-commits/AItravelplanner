import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Rate limiting for AI generation and modification endpoints (30 requests per 15 mins per IP)
export const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Rate limit exceeded: Too many travel planning requests from your network. Please wait a few minutes before trying again.'
  }
});

// Account-level quota limiting for expensive AI operations (configurable, default 15 requests/hour)
const userHourlyQuota = parseInt(process.env.AI_HOURLY_QUOTA_PER_USER || '15', 10);
export const aiUserQuotaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: userHourlyQuota,
  keyGenerator: (req: Request) => req.user?.userId || req.ip || 'anonymous',
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Account quota exceeded: You have reached the hourly limit for AI travel plan generations. Please try again later.'
  }
});
