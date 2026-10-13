import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { aiRateLimiter, aiUserQuotaLimiter } from '../middleware/rateLimiters.js';
import { acquireAiLock, releaseAiLock } from '../middleware/aiLock.js';
import { sanitizeLogMessage } from '../middleware/security.js';
import { validateGeneratePlanRequest, validateModifyPlanRequest } from '../validation.js';
import { generateTravelPlanService } from '../services/planner/planGenerator.js';
import { modifyTravelPlanService } from '../services/planner/planModifier.js';
import {
  saveTravelPlan,
  getTravelPlanByIdForUser,
  updateSavedTravelPlan
} from '../db/travelPlans.js';

const router = Router();

// Endpoint 1: Generate AI travel plan
router.post(
  '/generate-travel-plan',
  requireAuth,
  aiRateLimiter,
  aiUserQuotaLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const requestStart = Date.now();
    const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID().slice(0, 8);

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    if (!acquireAiLock(userId)) {
      res.status(429).json({
        success: false,
        error: 'A travel planning request is already being processed for your account. Please wait for it to finish.'
      });
      return;
    }

    try {
      const valStart = Date.now();
      const validation = validateGeneratePlanRequest(req.body);
      const validationMs = Date.now() - valStart;

      if (!validation.isValid || !validation.data) {
        res.status(400).json({
          success: false,
          error: validation.error || 'Invalid travel plan request.'
        });
        return;
      }

      const result = await generateTravelPlanService(validation.data, { correlationId });

      // Persist the successfully generated itinerary to PostgreSQL for the authenticated user
      let savedPlan: { id: string; createdAt: string } | null = null;
      let dbMs = 0;
      if (result.plan) {
        const dbStart = Date.now();
        try {
          savedPlan = await saveTravelPlan(userId, validation.data, result.plan);
        } catch (dbError: any) {
          console.error(`[TravelPlan Save DB Error] [corr:${correlationId}]:`, sanitizeLogMessage(dbError?.message || dbError));
        }
        dbMs = Date.now() - dbStart;
      }

      const totalBackendMs = Date.now() - requestStart;

      const timing = {
        correlationId,
        totalBackendMs,
        validationMs,
        resolveMs: result.metrics?.resolveMs ?? 0,
        catalogMs: result.metrics?.catalogMs ?? 0,
        geminiMs: result.metrics?.geminiMs ?? 0,
        parseValidationMs: result.metrics?.parseValidationMs ?? 0,
        dbMs,
        geminiCalls: result.metrics?.geminiCalls ?? 0,
        modelUsed: result.metrics?.modelUsed ?? 'unknown'
      };

      // Safe structured logging - sanitized, no credentials or prompt text
      console.log(
        `[Perf Telemetry] [corr:${correlationId}] destination="${validation.data.destination}" total=${totalBackendMs}ms ` +
        `gemini=${timing.geminiMs}ms catalog=${timing.catalogMs}ms db=${dbMs}ms model=${timing.modelUsed} calls=${timing.geminiCalls}`
      );

      // Standard Server-Timing header for browser devtools & tracing
      res.setHeader(
        'Server-Timing',
        `total;dur=${totalBackendMs}, gemini;dur=${timing.geminiMs}, catalog;dur=${timing.catalogMs}, db;dur=${dbMs}`
      );

      res.json({
        success: true,
        data: result.plan,
        id: savedPlan?.id,
        createdAt: savedPlan?.createdAt,
        isDemo: result.isDemo,
        timing,
        message: result.message || (result.isDemo
          ? 'Generated in demo mode. Provide GEMINI_API_KEY in server/.env for live AI generation.'
          : 'Plan generated successfully.')
      });
    } catch (error: any) {
      const errorDuration = Date.now() - requestStart;
      console.error(`[Generate Plan Route Error] [corr:${correlationId}] (after ${errorDuration}ms):`, sanitizeLogMessage(error?.message || error));

      if (error?.name === 'DestinationAmbiguityError' || error?.isClientError || error?.statusCode === 400 || error?.name === 'DestinationNotFoundError') {
        res.status(400).json({
          success: false,
          error: error.message || 'The specified destination could not be uniquely identified.'
        });
        return;
      }

      if (error?.statusCode === 429 || error?.name === 'RateLimitError' || error?.name === 'OsmRateLimitError' || error?.message?.includes('quota exceeded') || error?.message?.includes('rate limited')) {
        res.status(429).json({
          success: false,
          error: error.message || 'AI service quota exceeded or rate limited. Please try again in a few moments.'
        });
        return;
      }

      if (error?.statusCode === 504 || error?.name === 'DestinationProviderTimeoutError' || error?.name === 'OsmTimeoutError' || error?.name === 'TimeoutError' || error?.message?.includes('timed out')) {
        res.status(504).json({
          success: false,
          error: error.message || 'Travel planning service timed out while contacting upstream services. Please try again.'
        });
        return;
      }

      if (error?.isProviderError || error?.statusCode === 503 || error?.name === 'DestinationProviderError' || error?.name === 'DestinationProviderRateLimitError') {
        res.status(503).json({
          success: false,
          error: error.message || 'Upstream destination or mapping service is temporarily unavailable. Please try again shortly.'
        });
        return;
      }

      res.status(502).json({
        success: false,
        error: 'Travel planning service is temporarily unable to generate your plan. Please check your inputs and try again.'
      });
    } finally {
      releaseAiLock(userId);
    }
  }
);

// Endpoint 2: Modify existing travel plan
router.post(
  '/modify-travel-plan',
  requireAuth,
  aiRateLimiter,
  aiUserQuotaLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    if (!acquireAiLock(userId)) {
      res.status(429).json({
        success: false,
        error: 'A travel planning modification is already in progress for your account. Please wait for it to finish.'
      });
      return;
    }

    try {
      const validation = validateModifyPlanRequest(req.body);
      if (!validation.isValid || !validation.data) {
        res.status(400).json({
          success: false,
          error: validation.error || 'Invalid travel plan modification request.'
        });
        return;
      }

      // If an itineraryId is provided, verify ownership before executing expensive AI operations
      if (validation.data.itineraryId) {
        const existing = await getTravelPlanByIdForUser(validation.data.itineraryId, userId);
        if (!existing) {
          res.status(404).json({
            success: false,
            error: 'The saved itinerary you are modifying does not exist or does not belong to your account.'
          });
          return;
        }
      }

      const result = await modifyTravelPlanService(validation.data);

      // If modifying an existing saved itinerary, persist the updated plan to PostgreSQL
      let updateResult: { id: string; updatedAt: string } | null = null;
      if (validation.data.itineraryId && result.plan) {
        try {
          updateResult = await updateSavedTravelPlan(validation.data.itineraryId, userId, result.plan);
          if (!updateResult) {
            res.status(404).json({
              success: false,
              error: 'Failed to persist update: saved itinerary was not found or is unauthorized.'
            });
            return;
          }
        } catch (dbError: any) {
          console.error('[TravelPlan Modify DB Error]:', sanitizeLogMessage(dbError?.message || dbError));
          res.status(500).json({
            success: false,
            error: 'Failed to persist updated itinerary to database.'
          });
          return;
        }
      }

      res.json({
        success: true,
        data: result.plan,
        id: updateResult?.id,
        updatedAt: updateResult?.updatedAt,
        isDemo: result.isDemo,
        message: result.message || 'Plan updated successfully.'
      });
    } catch (error: any) {
      console.error('[Modify Plan Route Error]:', sanitizeLogMessage(error?.message || error));

      if (error?.name === 'DestinationAmbiguityError' || error?.isClientError || error?.statusCode === 400 || error?.name === 'DestinationNotFoundError') {
        res.status(400).json({
          success: false,
          error: error.message || 'The specified destination could not be uniquely identified.'
        });
        return;
      }

      if (error?.statusCode === 429 || error?.name === 'RateLimitError' || error?.message?.includes('quota exceeded') || error?.message?.includes('rate limited')) {
        res.status(429).json({
          success: false,
          error: error.message || 'AI service quota exceeded or rate limited. Please try again in a few moments.'
        });
        return;
      }

      if (error?.statusCode === 504 || error?.name === 'DestinationProviderTimeoutError' || error?.name === 'TimeoutError' || error?.message?.includes('timed out')) {
        res.status(504).json({
          success: false,
          error: error.message || 'Travel planning modification timed out. Please try again.'
        });
        return;
      }

      if (error?.isProviderError || error?.statusCode === 503) {
        res.status(503).json({
          success: false,
          error: error.message || 'Upstream service is temporarily unavailable. Please try again shortly.'
        });
        return;
      }

      res.status(502).json({
        success: false,
        error: 'Travel planning service is temporarily unable to update your plan. Please try again later.'
      });
    } finally {
      releaseAiLock(userId);
    }
  }
);

export default router;
