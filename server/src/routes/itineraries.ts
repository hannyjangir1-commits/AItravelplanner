import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isValidUuid } from '../validation.js';
import {
  getTravelPlansByUserId,
  getTravelPlanByIdForUser,
  deleteTravelPlanForUser
} from '../db/travelPlans.js';

const router = Router();

// Retrieve authenticated user's saved travel plans (history list)
router.get('/travel-plans', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const itineraries = await getTravelPlansByUserId(userId);
    res.json({
      itineraries
    });
  } catch (error: any) {
    console.error('[Get Travel Plans Route Error]:', error?.message || error);
    res.status(500).json({
      error: 'Unable to load travel history.'
    });
  }
});

// Retrieve full travel plan detail by ID for authenticated user
router.get('/travel-plans/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const { id } = req.params;
    if (!id || !isValidUuid(id)) {
      res.status(400).json({
        error: 'Invalid itinerary ID.'
      });
      return;
    }

    const itinerary = await getTravelPlanByIdForUser(id, userId);
    if (!itinerary) {
      res.status(404).json({
        error: 'Itinerary not found.'
      });
      return;
    }

    res.json({
      itinerary
    });
  } catch (error: any) {
    console.error('[Get Travel Plan Detail Route Error]:', error?.message || error);
    res.status(500).json({
      error: 'Unable to load itinerary.'
    });
  }
});

// Delete authenticated user's saved travel plan by ID
router.delete('/travel-plans/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const { id } = req.params;
    if (!id || !isValidUuid(id)) {
      res.status(400).json({
        error: 'Invalid itinerary ID.'
      });
      return;
    }

    const deleted = await deleteTravelPlanForUser(id, userId);
    if (!deleted) {
      res.status(404).json({
        error: 'Itinerary not found or unauthorized.'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Itinerary deleted successfully.'
    });
  } catch (error: any) {
    console.error('[Delete Travel Plan Route Error]:', error?.message || error);
    res.status(500).json({
      error: 'Unable to delete itinerary.'
    });
  }
});

export default router;
