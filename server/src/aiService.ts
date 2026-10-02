import { TravelPlan, GeneratePlanRequest, ModifyPlanRequest } from './types.js';

const SYSTEM_PROMPT = `You are an AI Travel Agent. Create a practical, personalized destination travel plan. Focus only on the experience at the chosen destination. Do not include flight, train or bus booking.

Consider destination, duration, budget, number of travellers, interests, accommodation preference and activity level.

Give realistic suggestions. Do not claim that prices, hotel availability, bookings, opening hours or weather are confirmed. Treat all recommendations as suggestions. Do not overload the itinerary. Return valid JSON only.`;

const JSON_SCHEMA_EXAMPLE = `{
  "accommodationGuidance": "Detailed guidance on the best areas/neighborhoods and types of hotels/hostels/resorts matching the budget and preference.",
  "placesToVisit": [
    {
      "name": "Location or Landmark Name",
      "reason": "Why visit and what makes it special",
      "bestTime": "Best time of day to visit"
    }
  ],
  "foodAndLocalExperiences": [
    {
      "name": "Dish or Local Restaurant / Market",
      "reason": "Why to try it and cultural significance"
    }
  ],
  "activities": [
    {
      "name": "Activity Name",
      "reason": "Why it suits the traveller's profile"
    }
  ],
  "weatherAdvice": "Practical weather overview and seasonal packing tips for the destination.",
  "budgetTips": [
    "Practical money-saving tip 1 in INR",
    "Practical tip 2"
  ],
  "itinerary": [
    {
      "day": 1,
      "morning": "Detailed morning activity",
      "afternoon": "Detailed afternoon plan and lunch recommendation",
      "evening": "Detailed evening stroll, sunset or dinner recommendation",
      "notes": "Practical tip regarding transit, timing, or dress code",
      "alternative": "Indoor or backup option in case of bad weather or fatigue"
    }
  ]
}`;

/**
 * Extracts the first complete top-level JSON object by counting matching braces.
 * This guarantees any trailing commentary, markdown ticks, or text from the model are ignored.
 */
function extractBalancedJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }
  }

  // Fallback if not cleanly closed
  const last = text.lastIndexOf('}');
  return last > start ? text.substring(start, last + 1) : text.substring(start);
}

/**
 * Clean and parse JSON from AI response, removing any markdown code blocks and trailing noise
 */
function cleanAndParseJSON(rawText: string): TravelPlan {
  let cleaned = rawText.trim();
  
  // Extract strictly between opening { and its corresponding matching }
  cleaned = extractBalancedJsonObject(cleaned);

  // Remove possible trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  const parsed = JSON.parse(cleaned);

  // Validate and provide defaults for critical fields
  if (!parsed.placesToVisit || !Array.isArray(parsed.placesToVisit)) parsed.placesToVisit = [];
  if (!parsed.foodAndLocalExperiences || !Array.isArray(parsed.foodAndLocalExperiences)) parsed.foodAndLocalExperiences = [];
  if (!parsed.activities || !Array.isArray(parsed.activities)) parsed.activities = [];
  if (!parsed.budgetTips || !Array.isArray(parsed.budgetTips)) parsed.budgetTips = [];
  if (!parsed.itinerary || !Array.isArray(parsed.itinerary)) parsed.itinerary = [];
  if (!parsed.accommodationGuidance) parsed.accommodationGuidance = 'Recommended stay options provided for the destination.';
  if (!parsed.weatherAdvice) parsed.weatherAdvice = 'Check local destination forecasts prior to your arrival.';

  return parsed as TravelPlan;
}

/**
 * Helper: sleep for ms
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini API with user prompt and system instruction.
 * Retries up to 3 times per model on 503 (overloaded) with exponential backoff.
 * Timeout is 60s to allow for large travel plan generation.
 */
async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('MISSING_KEY');
  }

  // Models to try in priority order (gemini-3.1-flash-lite and gemini-3-flash-preview have verified low latency and zero 503 spikes)
  const models = [
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.8-flash',
    'gemini-flash-latest'
  ];
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 60000; // 60 seconds — travel plan generation can be slow
  let lastError = '';

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
      maxOutputTokens: 8192
    }
  };

  for (const model of models) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        console.log(`[Gemini] Trying ${model} (attempt ${attempt}/${MAX_RETRIES})...`);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            console.log(`[Gemini] Success with ${model} on attempt ${attempt} (${text.length} chars)`);
            return text;
          }
          lastError = `${model}: empty response from API`;
          console.warn(`[Gemini] ${lastError}`);
          break; // Don't retry empty responses — move to next model
        }

        // Handle specific HTTP errors
        const errorBody = await response.text();
        lastError = `${model} (${response.status}): ${errorBody.substring(0, 200)}`;

        if (response.status === 503 || response.status === 429) {
          // Overloaded or rate-limited — retry with backoff
          const backoffMs = attempt * 3000; // 3s, 6s, 9s
          console.warn(`[Gemini] ${model} returned ${response.status}, retrying in ${backoffMs / 1000}s...`);
          await sleep(backoffMs);
          continue;
        }

        if (response.status === 404 || response.status === 400) {
          // Model not available — skip to next model immediately
          console.warn(`[Gemini] ${model} returned ${response.status}, skipping to next model.`);
          break;
        }

        // Other errors (401, 403, 500, etc.) — don't retry
        console.error(`[Gemini] ${model} returned ${response.status}: ${errorBody.substring(0, 200)}`);
        break;

      } catch (err: any) {
        lastError = `${model}: ${err.message}`;
        if (err.name === 'TimeoutError' || err.message?.includes('abort')) {
          console.warn(`[Gemini] ${model} timed out on attempt ${attempt}.`);
          break; // Timeout — move to next model
        }
        console.warn(`[Gemini] ${model} network error: ${err.message}`);
        break;
      }
    }
  }

  throw new Error(`All Gemini models unavailable. Last error: ${lastError}`);
}

/**
 * Generate a high quality fallback demo plan if the user hasn't added their API key yet
 */
function generateDemoPlan(req: GeneratePlanRequest): TravelPlan {
  const days = Math.min(Math.max(req.numberOfDays, 1), 7);
  const interestStr = req.interests.join(', ') || 'Exploring, Culture, Food';
  
  const itinerary: TravelPlan['itinerary'] = [];
  for (let i = 1; i <= days; i++) {
    itinerary.push({
      day: i,
      morning: `Day ${i} Morning: Explore key scenic spots in ${req.destination} aligned with ${req.interests[0] || 'local sightseeing'}. Enjoy a traditional breakfast at a popular local café.`,
      afternoon: `Day ${i} Afternoon: Visit historic landmarks and bustling markets. Savor an authentic regional lunch meeting your ${req.budgetInr} INR budget profile.`,
      evening: `Day ${i} Evening: Sunset viewpoint followed by dinner at a highly recommended local eatery. Relax and experience the destination's nightlife/atmosphere.`,
      notes: `Carry water, comfortable walking shoes for ${req.activityLevel.toLowerCase()} pace, and modest attire where required.`,
      alternative: `Indoor gallery, handicraft emporium, or sheltered café in case of unexpected rain or heat.`
    });
  }

  return {
    accommodationGuidance: `For a ${req.accommodationPreference.toLowerCase()} stay in ${req.destination} with ${req.numberOfTravellers} traveller(s) and a budget of ₹${req.budgetInr.toLocaleString('en-IN')}, consider staying centrally in the downtown or cultural district. This offers easy walking access to top attractions and great transit links.`,
    placesToVisit: [
      {
        name: `Iconic Landmark of ${req.destination}`,
        reason: `Must-visit signature highlight offering the best cultural insights and views.`,
        bestTime: 'Early morning (08:30 AM) to avoid crowds'
      },
      {
        name: `Old Town Heritage Quarter`,
        reason: `Charming streets, architecture, and photo opportunities.`,
        bestTime: 'Late afternoon before sunset'
      },
      {
        name: `Scenic Nature Viewpoint / Coastline`,
        reason: `Offers breathtaking panoramic views and fresh ambiance.`,
        bestTime: 'Golden hour (05:30 PM)'
      }
    ],
    foodAndLocalExperiences: [
      {
        name: `Authentic Local Specialties of ${req.destination}`,
        reason: `Sample the renowned delicacies and street food stalls loved by locals.`
      },
      {
        name: `Traditional Tea / Spice Tasting or Night Market`,
        reason: `Immerse yourself in authentic regional aromas and culinary heritage.`
      }
    ],
    activities: [
      {
        name: `Guided Heritage Walk & Photography Tour`,
        reason: `Ideal for ${interestStr} matching your ${req.activityLevel.toLowerCase()} activity style.`
      },
      {
        name: `Local Artisan Craft & Souvenir Discovery`,
        reason: `Support local craftsmen and pick up authentic regional keepsakes.`
      }
    ],
    weatherAdvice: `Check current seasonal forecasts for ${req.destination}. Pack breathable layers, sun protection, and an umbrella or light jacket for changing conditions.`,
    budgetTips: [
      `Allocate approx ₹${Math.round(req.budgetInr * 0.4).toLocaleString('en-IN')} for accommodation and ₹${Math.round(req.budgetInr * 0.35).toLocaleString('en-IN')} for dining and sightseeing.`,
      `Use authorized local cabs or public transit instead of private booking brokers to save up to 40%.`,
      `Eat where locals eat for authentic flavors at a fraction of tourist restaurant prices.`
    ],
    itinerary
  };
}

/**
 * Generate initial travel plan
 */
export async function generateTravelPlanService(request: GeneratePlanRequest): Promise<{ plan: TravelPlan; isDemo: boolean }> {
  const userPrompt = `
Create a detailed, personalized destination travel plan for:
- Destination: ${request.destination}
- Number of Days: ${request.numberOfDays}
- Total Budget in INR: ₹${request.budgetInr}
- Number of Travellers: ${request.numberOfTravellers}
- Interests: ${request.interests.join(', ') || 'General sightseeing'}
- Accommodation Preference: ${request.accommodationPreference}
- Activity Level: ${request.activityLevel}
${request.additionalNotes ? `- Additional Notes / Preferences: ${request.additionalNotes}` : ''}

You must return ONLY a valid JSON object strictly matching this format:
${JSON_SCHEMA_EXAMPLE}
`;

  try {
    const rawAiResponse = await callGemini(SYSTEM_PROMPT, userPrompt);
    const parsedPlan = cleanAndParseJSON(rawAiResponse);
    return { plan: parsedPlan, isDemo: false };
  } catch (error: any) {
    console.warn('Live Gemini API call notice:', error.message);
    const fallbackPlan = generateDemoPlan(request);
    return { plan: fallbackPlan, isDemo: true };
  }
}

/**
 * Modify existing travel plan
 */
export async function modifyTravelPlanService(request: ModifyPlanRequest): Promise<{ plan: TravelPlan; isDemo: boolean }> {
  const modifyInstruction = `Update the existing travel plan according to the user's new request. Keep the original destination, duration, budget and travel preferences unless the user explicitly asks to change them. Return the complete updated travel plan in the same JSON format only.`;

  const userPrompt = `
${modifyInstruction}

ORIGINAL TRIP DETAILS:
- Destination: ${request.originalDetails.destination}
- Number of Days: ${request.originalDetails.numberOfDays}
- Total Budget in INR: ₹${request.originalDetails.budgetInr}
- Number of Travellers: ${request.originalDetails.numberOfTravellers}
- Interests: ${request.originalDetails.interests.join(', ')}
- Accommodation Preference: ${request.originalDetails.accommodationPreference}
- Activity Level: ${request.originalDetails.activityLevel}
${request.originalDetails.additionalNotes ? `- Additional Notes: ${request.originalDetails.additionalNotes}` : ''}

CURRENT TRAVEL PLAN (JSON):
${JSON.stringify(request.currentPlan, null, 2)}

USER'S MODIFICATION REQUEST:
"${request.modificationRequest}"

You must return the COMPLETE updated travel plan as a valid JSON object adhering strictly to this schema:
${JSON_SCHEMA_EXAMPLE}
`;

  try {
    const rawAiResponse = await callGemini(SYSTEM_PROMPT, userPrompt);
    const parsedPlan = cleanAndParseJSON(rawAiResponse);
    return { plan: parsedPlan, isDemo: false };
  } catch (error: any) {
    console.warn('Live Gemini API call notice:', error.message);
    const updatedPlan = JSON.parse(JSON.stringify(request.currentPlan)) as TravelPlan;
    updatedPlan.budgetTips.unshift(`Revision applied: "${request.modificationRequest}"`);
    updatedPlan.accommodationGuidance += ` (Adjusted for: ${request.modificationRequest})`;
    if (updatedPlan.itinerary.length > 0) {
      updatedPlan.itinerary[0].notes += ` [Modified: ${request.modificationRequest}]`;
    }
    return { plan: updatedPlan, isDemo: true };
  }
}
