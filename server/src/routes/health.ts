import { Router, Request, Response } from 'express';
import { checkDbHealth } from '../db/init.js';

const router = Router();

// Health check endpoint (lightweight liveness probe for Docker and Render)
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'AI Travel Agent API'
  });
});

// Safe database readiness check (safe boolean status without exposing internal schema, columns, or connection details)
router.get('/db-health', async (_req: Request, res: Response) => {
  const health = await checkDbHealth();
  const statusCode = health.success ? 200 : 503;
  res.status(statusCode).json({
    status: health.success ? 'ready' : 'unavailable',
    database: health.database
  });
});

export default router;
