import {
  TravelPlan,
  ModifyPlanRequest,
  DayPlan
} from '../../types.js';
import {
  resolveDestination
} from '../destinationResolver.js';
import {
  buildVerifiedPlaceCatalog,
  VerifiedPlaceCatalog
} from '../placeCatalog.js';
import {
  validateAndSanitizeTravelPlan
} from '../travelPlanValidator.js';
import {
  GROUNDED_SYSTEM_PROMPT,
  buildPlanModificationUserPrompt
} from '../ai/prompts.js';
import {
  cleanAndParseJSON,
  redactApiKey
} from '../ai/jsonParser.js';
import {
  callGemini
} from '../ai/geminiClient.js';

/**
 * Validates the modified plan structure from AI response and merges any missing fields from original plan.
 * Returns null if the AI response is fundamentally invalid or lacks an itinerary.
 */
export function validateAndMergeModifiedPlan(
  parsed: any,
  originalPlan: TravelPlan,
  expectedDays: number
): TravelPlan | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const shouldIncludeItinerary = originalPlan.includeDayByDayItinerary ?? (Array.isArray(originalPlan.itinerary) && originalPlan.itinerary.length > 0);

  const validatedItinerary: DayPlan[] = [];

  if (shouldIncludeItinerary) {
    // Must contain an itinerary array with expected days when itinerary was expected
    if (!Array.isArray(parsed.itinerary) || parsed.itinerary.length === 0) {
      return null;
    }

    if (expectedDays && parsed.itinerary.length !== expectedDays) {
      return null;
    }

    // Validate each day in itinerary
    for (let i = 0; i < parsed.itinerary.length; i++) {
      const item = parsed.itinerary[i];
      if (!item || typeof item !== 'object') {
        return null;
      }
      const dayNumber = Number(item.day) || (i + 1);
      const fallbackDay = originalPlan.itinerary[i] || originalPlan.itinerary[0];

      validatedItinerary.push({
        day: dayNumber,
        morning:
          typeof item.morning === 'string' && item.morning.trim() !== ''
            ? item.morning.trim()
            : fallbackDay?.morning || 'Morning exploration and sightseeing',
        morningPlaceId:
          typeof item.morningPlaceId === 'string' && item.morningPlaceId.trim()
            ? item.morningPlaceId.trim()
            : fallbackDay?.morningPlaceId,
        afternoon:
          typeof item.afternoon === 'string' && item.afternoon.trim() !== ''
            ? item.afternoon.trim()
            : fallbackDay?.afternoon || 'Afternoon discovery and local dining',
        afternoonPlaceId:
          typeof item.afternoonPlaceId === 'string' && item.afternoonPlaceId.trim()
            ? item.afternoonPlaceId.trim()
            : fallbackDay?.afternoonPlaceId,
        evening:
          typeof item.evening === 'string' && item.evening.trim() !== ''
            ? item.evening.trim()
            : fallbackDay?.evening || 'Evening cultural activity and dinner',
        eveningPlaceId:
          typeof item.eveningPlaceId === 'string' && item.eveningPlaceId.trim()
            ? item.eveningPlaceId.trim()
            : fallbackDay?.eveningPlaceId,
        notes: typeof item.notes === 'string' ? item.notes : fallbackDay?.notes || '',
        alternative:
          typeof item.alternative === 'string' ? item.alternative : fallbackDay?.alternative || ''
      });
    }
  }

  // Preserve fields if omitted or empty
  const accommodationGuidance =
    typeof parsed.accommodationGuidance === 'string' && parsed.accommodationGuidance.trim() !== ''
      ? parsed.accommodationGuidance
      : originalPlan.accommodationGuidance;

  const weatherAdvice =
    typeof parsed.weatherAdvice === 'string' && parsed.weatherAdvice.trim() !== ''
      ? parsed.weatherAdvice
      : originalPlan.weatherAdvice;

  const placesToVisit =
    Array.isArray(parsed.placesToVisit) && parsed.placesToVisit.length > 0
      ? parsed.placesToVisit
          .filter((p: any) => p && typeof p === 'object' && typeof p.name === 'string')
          .map((p: any) => ({
            verifiedPlaceId: typeof p.verifiedPlaceId === 'string' && p.verifiedPlaceId.trim() ? p.verifiedPlaceId.trim() : (p.verifiedPlaceId === null ? null : undefined),
            name: p.name,
            reason: typeof p.reason === 'string' ? p.reason : '',
            bestTime: typeof p.bestTime === 'string' ? p.bestTime : '',
            verificationStatus: p.verificationStatus === 'verified' ? 'verified' : (p.verificationStatus === 'unverified' ? 'unverified' : undefined),
            source: p.source === 'catalog' ? 'catalog' : (p.source === 'ai_suggestion' ? 'ai_suggestion' : undefined)
          }))
      : originalPlan.placesToVisit;

  const foodAndLocalExperiences =
    Array.isArray(parsed.foodAndLocalExperiences) && parsed.foodAndLocalExperiences.length > 0
      ? parsed.foodAndLocalExperiences
          .filter((f: any) => f && typeof f === 'object' && typeof f.name === 'string')
          .map((f: any) => ({
            verifiedPlaceId: typeof f.verifiedPlaceId === 'string' && f.verifiedPlaceId.trim() ? f.verifiedPlaceId.trim() : (f.verifiedPlaceId === null ? null : undefined),
            name: f.name,
            reason: typeof f.reason === 'string' ? f.reason : '',
            verificationStatus: f.verificationStatus === 'verified' ? 'verified' : (f.verificationStatus === 'unverified' ? 'unverified' : undefined),
            source: f.source === 'catalog' ? 'catalog' : (f.source === 'ai_suggestion' ? 'ai_suggestion' : undefined)
          }))
      : originalPlan.foodAndLocalExperiences;

  const activities =
    Array.isArray(parsed.activities) && parsed.activities.length > 0
      ? parsed.activities
          .filter((a: any) => a && typeof a === 'object' && typeof a.name === 'string')
          .map((a: any) => ({
            verifiedPlaceId: typeof a.verifiedPlaceId === 'string' && a.verifiedPlaceId.trim() ? a.verifiedPlaceId.trim() : (a.verifiedPlaceId === null ? null : undefined),
            name: a.name,
            reason: typeof a.reason === 'string' ? a.reason : '',
            verificationStatus: a.verificationStatus === 'verified' ? 'verified' : (a.verificationStatus === 'unverified' ? 'unverified' : undefined),
            source: a.source === 'catalog' ? 'catalog' : (a.source === 'ai_suggestion' ? 'ai_suggestion' : undefined)
          }))
      : originalPlan.activities;

  const budgetTips =
    Array.isArray(parsed.budgetTips) && parsed.budgetTips.length > 0
      ? parsed.budgetTips.filter((t: any) => typeof t === 'string' && t.trim() !== '')
      : originalPlan.budgetTips;

  return {
    accommodationGuidance,
    placesToVisit,
    foodAndLocalExperiences,
    activities,
    weatherAdvice,
    budgetTips,
    itinerary: validatedItinerary,
    includeDayByDayItinerary: shouldIncludeItinerary
  };
}

/**
 * Modify existing travel plan
 */
export async function modifyTravelPlanService(
  request: ModifyPlanRequest,
  options: { fetchFn?: typeof fetch; catalogOverride?: VerifiedPlaceCatalog } = {}
): Promise<{ plan: TravelPlan; isDemo: boolean; message?: string }> {
  // Deep clone of original plan so it is never mutated or destroyed on failure
  const originalPlanCopy: TravelPlan = JSON.parse(JSON.stringify(request.currentPlan));

  // Determine authoritative verified catalog for modification grounding
  let catalog: VerifiedPlaceCatalog;
  if (options.catalogOverride) {
    catalog = options.catalogOverride;
  } else if (
    request.currentPlan.verifiedPlacesCatalog &&
    Array.isArray(request.currentPlan.verifiedPlacesCatalog) &&
    request.currentPlan.resolvedDestination
  ) {
    const places = request.currentPlan.verifiedPlacesCatalog;
    catalog = {
      destination: request.currentPlan.resolvedDestination,
      places,
      byCategory: {
        accommodation: places.filter(p => p.primaryCategory === 'accommodation'),
        attraction: places.filter(p => p.primaryCategory === 'attraction'),
        restaurant: places.filter(p => p.primaryCategory === 'restaurant'),
        activity: places.filter(p => p.primaryCategory === 'activity'),
        poi: places.filter(p => p.primaryCategory === 'poi')
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        searchRadiiMeters: [5000, 15000, 25000],
        totalVerifiedPlaces: places.length,
        dataSource: 'OpenStreetMap (ODbL)'
      }
    };
  } else {
    try {
      const resolvedDest = await resolveDestination(request.originalDetails.destination, {
        fetchFn: options.fetchFn
      });
      catalog = await buildVerifiedPlaceCatalog(resolvedDest, { fetchFn: options.fetchFn });
    } catch {
      catalog = {
        destination: {
          originalInput: request.originalDetails.destination,
          canonicalName: request.originalDetails.destination,
          formattedAddress: request.originalDetails.destination,
          latitude: 0,
          longitude: 0,
          addressComponents: []
        },
        places: [],
        byCategory: { accommodation: [], attraction: [], restaurant: [], activity: [], poi: [] },
        metadata: { generatedAt: new Date().toISOString(), searchRadiiMeters: [], totalVerifiedPlaces: 0, dataSource: 'OpenStreetMap (ODbL)' }
      };
    }
  }

  const hadItinerary = request.currentPlan.includeDayByDayItinerary ?? (Array.isArray(request.currentPlan.itinerary) && request.currentPlan.itinerary.length > 0);
  const userPrompt = buildPlanModificationUserPrompt(request, catalog, hadItinerary);

  try {
    const { text: rawAiResponse } = await callGemini(GROUNDED_SYSTEM_PROMPT, userPrompt, {
      fetchFn: options.fetchFn,
      maxOutputTokens: 6000
    });
    const parsedPlan = cleanAndParseJSON(rawAiResponse, {
      requireItinerary: hadItinerary,
      expectedDays: request.originalDetails.numberOfDays
    });
    const validatedPlan = validateAndMergeModifiedPlan(
      parsedPlan,
      originalPlanCopy,
      request.originalDetails.numberOfDays
    );

    if (!validatedPlan) {
      throw new Error('AI returned an incomplete or invalid travel plan structure during modification.');
    }

    validatedPlan.generatedAt = new Date().toISOString();
    validatedPlan.resolvedDestination = catalog.destination;
    validatedPlan.verifiedPlacesCatalog = catalog.places;
    validatedPlan.includeDayByDayItinerary = hadItinerary;

    // Authoritative Post-Generation Validation Boundary for modification
    const { plan: sanitizedModifiedPlan, validationReport: modReport } = validateAndSanitizeTravelPlan(validatedPlan, catalog);
    console.log('[TravelPlan Validator (Modify)] Report:', JSON.stringify(modReport));

    return {
      plan: sanitizedModifiedPlan,
      isDemo: false,
      message: `Travel plan successfully updated for: "${request.modificationRequest}".`
    };
  } catch (error: any) {
    const safeErrorMsg = redactApiKey(error?.message || 'Unknown error');
    console.error('[Gemini Service Modify Failure]:', safeErrorMsg);

    let userMessage = 'AI travel plan modification was temporarily unavailable.';
    const errMsgLower = safeErrorMsg.toLowerCase();

    let statusCode = 502;
    if (errMsgLower.includes('missing_key') || errMsgLower.includes('gemini_api_key')) {
      userMessage = 'GEMINI_API_KEY is not configured in server/.env. Please provide a valid Gemini API key.';
      statusCode = 503;
    } else if (errMsgLower.includes('429') || errMsgLower.includes('rate limit') || errMsgLower.includes('quota')) {
      userMessage = 'Gemini AI service quota exceeded or rate limited. Please try again in a few moments.';
      statusCode = 429;
    } else if (errMsgLower.includes('503') || errMsgLower.includes('overloaded')) {
      userMessage = 'Gemini AI service is currently overloaded. Please try again shortly.';
      statusCode = 503;
    } else if (errMsgLower.includes('timeout') || errMsgLower.includes('abort')) {
      userMessage = 'Gemini AI modification request timed out. Please try again.';
      statusCode = 504;
    } else if (errMsgLower.includes('empty response')) {
      userMessage = 'Gemini AI returned an empty response. Please try again.';
      statusCode = 502;
    } else if (errMsgLower.includes('invalid json') || errMsgLower.includes('failed to parse')) {
      userMessage = 'Gemini AI returned an unreadable response format. Please try again.';
      statusCode = 502;
    } else if (errMsgLower.includes('incomplete') || errMsgLower.includes('itinerary schedule') || errMsgLower.includes('day(s) of itinerary')) {
      userMessage = 'Gemini AI returned an incomplete plan structure during modification. Please try again.';
      statusCode = 502;
    } else {
      userMessage = `AI modification failed: ${safeErrorMsg}`;
    }

    const errObj = new Error(userMessage);
    (errObj as any).statusCode = statusCode;
    throw errObj;
  }
}
