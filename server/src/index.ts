import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTravelPlanService, modifyTravelPlanService } from './aiService.js';
import { GeneratePlanRequest, ModifyPlanRequest } from './types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Serve React static files in production
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'AI Travel Agent API',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '' && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here')
  });
});

// Endpoint 1: Generate initial travel plan
app.post('/api/generate-travel-plan', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      destination,
      numberOfDays,
      budgetInr,
      numberOfTravellers,
      interests,
      accommodationPreference,
      activityLevel,
      additionalNotes
    } = req.body;

    if (!destination || typeof destination !== 'string' || destination.trim() === '') {
      res.status(400).json({ error: 'Destination is required and must be a valid text string.' });
      return;
    }

    const days = Number(numberOfDays);
    if (isNaN(days) || days <= 0 || days > 30) {
      res.status(400).json({ error: 'Number of days must be a number between 1 and 30.' });
      return;
    }

    const budget = Number(budgetInr);
    if (isNaN(budget) || budget <= 0) {
      res.status(400).json({ error: 'Total budget in INR must be a positive number.' });
      return;
    }

    const travellers = Number(numberOfTravellers);
    if (isNaN(travellers) || travellers <= 0) {
      res.status(400).json({ error: 'Number of travellers must be at least 1.' });
      return;
    }

    const validAcc = ['Budget', 'Moderate', 'Premium'];
    const acc = validAcc.includes(accommodationPreference) ? accommodationPreference : 'Moderate';

    const validAct = ['Relaxed', 'Moderate', 'Active'];
    const act = validAct.includes(activityLevel) ? activityLevel : 'Moderate';

    const cleanInterests = Array.isArray(interests) ? interests.map(i => String(i).trim()).filter(Boolean) : [];

    const planRequest: GeneratePlanRequest = {
      destination: destination.trim(),
      numberOfDays: days,
      budgetInr: budget,
      numberOfTravellers: travellers,
      interests: cleanInterests,
      accommodationPreference: acc,
      activityLevel: act,
      additionalNotes: typeof additionalNotes === 'string' ? additionalNotes.trim() : undefined
    };

    const result = await generateTravelPlanService(planRequest);
    res.json({
      success: true,
      data: result.plan,
      isDemo: result.isDemo,
      message: result.isDemo
        ? 'Generated in demo mode. Provide GEMINI_API_KEY in server/.env for live AI generation.'
        : 'Plan generated successfully.'
    });
  } catch (error: any) {
    console.error('Error in /generate-travel-plan route:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate travel plan. Please try again.'
    });
  }
});

// Endpoint 2: Modify existing travel plan
app.post('/api/modify-travel-plan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { originalDetails, currentPlan, modificationRequest } = req.body;

    if (!originalDetails || !originalDetails.destination) {
      res.status(400).json({ error: 'Original trip details are required to modify the plan.' });
      return;
    }

    if (!currentPlan || !Array.isArray(currentPlan.itinerary)) {
      res.status(400).json({ error: 'Current travel plan is required to modify.' });
      return;
    }

    if (!modificationRequest || typeof modificationRequest !== 'string' || modificationRequest.trim() === '') {
      res.status(400).json({ error: 'Please enter a modification request (e.g. "Add more food places").' });
      return;
    }

    const modifyRequest: ModifyPlanRequest = {
      originalDetails,
      currentPlan,
      modificationRequest: modificationRequest.trim()
    };

    const result = await modifyTravelPlanService(modifyRequest);
    res.json({
      success: true,
      data: result.plan,
      isDemo: result.isDemo,
      message: result.isDemo
        ? 'Plan modified in demo mode. Provide GEMINI_API_KEY in server/.env for live AI generation.'
        : 'Plan updated successfully.'
    });
  } catch (error: any) {
    console.error('Error in /modify-travel-plan route:', error);
    res.status(500).json({
      error: error.message || 'Failed to modify travel plan. Please try again.'
    });
  }
});

// Fallback route for SPA (React router / client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI Travel Agent server running on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('Notice: GEMINI_API_KEY is not set in server/.env. Demo fallback mode is enabled.');
  } else {
    console.log('Gemini API key detected.');
  }
});
