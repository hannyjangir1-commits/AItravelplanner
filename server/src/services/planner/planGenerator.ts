import {
  TravelPlan,
  GeneratePlanRequest
} from '../../types.js';
import {
  resolveDestination,
  ResolvedDestination,
  DestinationAmbiguityError,
  OsmNoResultsError,
  OsmTimeoutError,
  OsmRateLimitError
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
  buildPlanGenerationUserPrompt
} from '../ai/prompts.js';
import {
  cleanAndParseJSON,
  redactApiKey
} from '../ai/jsonParser.js';
import {
  callGemini
} from '../ai/geminiClient.js';
import {
  generateCatalogGroundedFallback
} from './fallbackGenerator.js';

export interface GeneratePlanServiceOptions {
  fetchFn?: typeof fetch;
  catalogOverride?: VerifiedPlaceCatalog;
  resolvedDestinationOverride?: ResolvedDestination;
  correlationId?: string;
  allowFallback?: boolean;
}

export interface GeneratePlanServiceResult {
  plan: TravelPlan;
  isDemo: boolean;
  message?: string;
  metrics?: {
    correlationId: string;
    osmMs: number;
    resolveMs: number;
    catalogMs: number;
    geminiMs: number;
    model: string;
    modelUsed: string;
    geminiAttempts: number;
    geminiCalls: number;
    parseValidationMs: number;
  };
}

/**
 * End-to-end travel plan generation orchestration:
 * 1. Resolves destination via OpenStreetMap Nominatim
 * 2. Builds verified catalog of real-world places via Overpass API
 * 3. Calls Google Gemini cascade with verified catalog context
 * 4. Parses, balances, and sanitizes structured JSON response
 * 5. Validates against catalog to classify verified vs unverified suggestions
 * 6. Falls back safely to deterministic grounded fallback when AI is unavailable
 */
export async function generateTravelPlanService(
  request: GeneratePlanRequest,
  options: GeneratePlanServiceOptions = {}
): Promise<GeneratePlanServiceResult> {
  const correlationId = options.correlationId || `gen_${Date.now().toString(36)}`;

  // 1. Resolve destination to authoritative geographic search anchor via OpenStreetMap
  let resolvedDest: ResolvedDestination;
  let resolveMs = 0;
  if (options.catalogOverride) {
    resolvedDest = options.catalogOverride.destination;
  } else if (options.resolvedDestinationOverride) {
    resolvedDest = options.resolvedDestinationOverride;
  } else {
    try {
      const tResolveStart = performance.now();
      resolvedDest = await resolveDestination(request.destination, {
        fetchFn: options.fetchFn
      });
      resolveMs = performance.now() - tResolveStart;
    } catch (destErr: any) {
      if (destErr instanceof DestinationAmbiguityError || destErr?.name === 'DestinationAmbiguityError') {
        (destErr as any).isClientError = true;
        (destErr as any).statusCode = 400;
        throw destErr;
      }
      if (destErr instanceof OsmNoResultsError || destErr?.name === 'OsmNoResultsError') {
        const notFoundErr = new Error(
          `Unable to locate destination "${request.destination}". Please verify the spelling or specify the district/state.`
        );
        (notFoundErr as any).name = 'DestinationNotFoundError';
        (notFoundErr as any).isClientError = true;
        (notFoundErr as any).statusCode = 400;
        throw notFoundErr;
      }
      if (
        destErr instanceof OsmTimeoutError ||
        destErr?.name === 'OsmTimeoutError' ||
        destErr?.name === 'TimeoutError' ||
        destErr?.message?.includes('timed out') ||
        destErr?.message?.includes('timeout')
      ) {
        const timeoutErr = new Error(
          `Destination lookup timed out for "${request.destination}". OpenStreetMap geocoding service took too long to respond.`
        );
        (timeoutErr as any).name = 'DestinationProviderTimeoutError';
        (timeoutErr as any).isProviderError = true;
        (timeoutErr as any).statusCode = 504;
        throw timeoutErr;
      }
      if (destErr instanceof OsmRateLimitError || destErr?.name === 'OsmRateLimitError') {
        const rateLimitErr = new Error(
          'Destination lookup service is currently rate-limited. Please wait a moment and try again.'
        );
        (rateLimitErr as any).name = 'DestinationProviderRateLimitError';
        (rateLimitErr as any).isProviderError = true;
        (rateLimitErr as any).statusCode = 503;
        throw rateLimitErr;
      }
      // Never fall back silently to (0, 0)
      const providerErr = new Error(
        `Failed to resolve destination "${request.destination}" on OpenStreetMap: ${destErr.message || 'Geocoding service unavailable'}.`
      );
      (providerErr as any).name = 'DestinationProviderError';
      (providerErr as any).isProviderError = true;
      (providerErr as any).statusCode = 503;
      throw providerErr;
    }
  }

  // 2. Build verified real-world places catalog
  let catalog: VerifiedPlaceCatalog;
  let catalogMs = 0;
  if (options.catalogOverride) {
    catalog = options.catalogOverride;
  } else {
    try {
      const tCatalogStart = performance.now();
      catalog = await buildVerifiedPlaceCatalog(resolvedDest, {
        fetchFn: options.fetchFn
      });
      catalogMs = performance.now() - tCatalogStart;
    } catch (catErr: any) {
      console.warn('[Place Catalog Diagnostics] Failed to build catalog, proceeding with empty catalog:', catErr.message);
      catalog = {
        destination: resolvedDest,
        places: [],
        byCategory: { accommodation: [], attraction: [], restaurant: [], activity: [], poi: [] },
        metadata: { generatedAt: new Date().toISOString(), searchRadiiMeters: [], totalVerifiedPlaces: 0, dataSource: 'OpenStreetMap (ODbL)' }
      };
    }
  }

  console.log(
    `[Places Service Diagnostics][${correlationId}] Verified catalog ready for "${catalog.destination.canonicalName}": ` +
    `totalVerified=${catalog.places.length} (Accom: ${catalog.byCategory.accommodation.length}, ` +
    `Attr: ${catalog.byCategory.attraction.length}, Rest: ${catalog.byCategory.restaurant.length}, ` +
    `Act: ${catalog.byCategory.activity.length}), resolveMs=${resolveMs.toFixed(1)}, catalogMs=${catalogMs.toFixed(1)}`
  );

  const shouldIncludeItinerary = request.includeDayByDayItinerary !== false;
  const userPrompt = buildPlanGenerationUserPrompt(request, catalog, shouldIncludeItinerary);

  try {
    // Dynamic token cap: bounded to actual schema size to reduce model latency
    const maxOutputTokens = shouldIncludeItinerary
      ? Math.min(Math.max(2500, (request.numberOfDays || 3) * 500 + 1500), 8192)
      : 2048;

    const tGeminiStart = performance.now();
    const { text: rawAiResponse, metrics: geminiMetrics } = await callGemini(
      GROUNDED_SYSTEM_PROMPT,
      userPrompt,
      {
        fetchFn: options.fetchFn,
        maxOutputTokens,
        correlationId
      }
    );
    const geminiMs = performance.now() - tGeminiStart;

    const tParseStart = performance.now();
    const parsedPlan = cleanAndParseJSON(rawAiResponse, {
      requireItinerary: shouldIncludeItinerary,
      expectedDays: request.numberOfDays
    });

    parsedPlan.generatedAt = new Date().toISOString();
    parsedPlan.resolvedDestination = catalog.destination;
    parsedPlan.verifiedPlacesCatalog = catalog.places;
    parsedPlan.includeDayByDayItinerary = shouldIncludeItinerary;

    // Authoritative Post-Generation Validation Boundary
    const { plan: validatedPlan, validationReport } = validateAndSanitizeTravelPlan(parsedPlan, catalog);
    const parseValidationMs = performance.now() - tParseStart;

    console.log(`[TravelPlan Validator][${correlationId}] Report:`, JSON.stringify(validationReport));

    const hasVerified = catalog.places.length > 0;
    const planMessage = hasVerified
      ? `Plan generated successfully with ${catalog.places.length} verified OpenStreetMap places.`
      : `Sparse or limited place data found within search area for ${catalog.destination.canonicalName}. Plan generated with verified destination guidance.`;

    return {
      plan: validatedPlan,
      isDemo: false,
      message: planMessage,
      metrics: {
        correlationId,
        osmMs: resolveMs + catalogMs,
        resolveMs,
        catalogMs,
        geminiMs,
        model: geminiMetrics.model,
        modelUsed: geminiMetrics.model,
        geminiAttempts: geminiMetrics.totalAttempts,
        geminiCalls: geminiMetrics.totalAttempts,
        parseValidationMs
      }
    };
  } catch (error: any) {
    const safeErrorMsg = redactApiKey(error?.message || 'Unknown error');
    const cascadeDiagnostics = (error as any)?.diagnostics || [];
    console.warn(`[Gemini Service Fallback Trigger][${correlationId}]:`, safeErrorMsg);
    if (cascadeDiagnostics.length > 0) {
      console.warn(`[Gemini Cascade Diagnostics][${correlationId}]:`, JSON.stringify(cascadeDiagnostics));
    }

    // If caller explicitly disabled fallback, throw safe formatted error
    if (options.allowFallback === false) {
      let userMessage = 'AI travel plan generation was temporarily unavailable.';
      const errMsgLower = safeErrorMsg.toLowerCase();
      let statusCode = 502;

      if (errMsgLower.includes('missing_key') || errMsgLower.includes('gemini_api_key')) {
        userMessage = 'GEMINI_API_KEY is not configured in server/.env. Please provide a valid Gemini API key.';
        statusCode = 503;
      } else if (errMsgLower.includes('ambiguous')) {
        userMessage = safeErrorMsg;
        statusCode = 400;
      } else if (errMsgLower.includes('unable to locate destination')) {
        userMessage = safeErrorMsg;
        statusCode = 400;
      } else if (errMsgLower.includes('429') || errMsgLower.includes('rate limit') || errMsgLower.includes('quota')) {
        userMessage = 'Gemini AI service quota exceeded or rate limited. Please try again in a few moments.';
        statusCode = 429;
      } else if (errMsgLower.includes('503') || errMsgLower.includes('overloaded')) {
        userMessage = 'Gemini AI service is currently overloaded. Please try again shortly.';
        statusCode = 503;
      } else if (errMsgLower.includes('timeout') || errMsgLower.includes('abort')) {
        userMessage = 'Gemini AI request timed out. Please try again.';
        statusCode = 504;
      } else if (errMsgLower.includes('empty response')) {
        userMessage = 'Gemini AI returned an empty response. Please try again.';
        statusCode = 502;
      } else if (errMsgLower.includes('invalid json') || errMsgLower.includes('failed to parse')) {
        userMessage = 'Gemini AI returned an unreadable response format. Please try again.';
        statusCode = 502;
      } else if (errMsgLower.includes('itinerary schedule') || errMsgLower.includes('day(s) of itinerary')) {
        userMessage = 'Gemini AI returned an incomplete itinerary schedule. Please try again.';
        statusCode = 502;
      } else {
        userMessage = `AI plan generation failed: ${safeErrorMsg}`;
      }

      const errObj = new Error(userMessage);
      (errObj as any).statusCode = statusCode;
      throw errObj;
    }

    // Default intended behavior: synthesize catalog-grounded fallback
    try {
      const fallbackPlan = generateCatalogGroundedFallback(request, catalog);
      fallbackPlan.generatedAt = new Date().toISOString();
      fallbackPlan.resolvedDestination = catalog.destination;
      fallbackPlan.verifiedPlacesCatalog = catalog.places;
      fallbackPlan.includeDayByDayItinerary = shouldIncludeItinerary;

      const { plan: validatedPlan, validationReport } = validateAndSanitizeTravelPlan(fallbackPlan, catalog);
      console.log(`[TravelPlan Validator (Catalog Fallback)][${correlationId}] Report:`, JSON.stringify(validationReport));

      const hasVerified = catalog.places.length > 0;
      const fallbackNotice = hasVerified
        ? `Generated a grounded plan using ${catalog.places.length} verified OpenStreetMap catalog records (Demo / Fallback mode).`
        : `Generated a grounded plan with verified destination guidance for ${catalog.destination.canonicalName} (Demo / Fallback mode).`;

      return {
        plan: validatedPlan,
        isDemo: true,
        message: fallbackNotice,
        metrics: {
          correlationId,
          osmMs: resolveMs + catalogMs,
          resolveMs,
          catalogMs,
          geminiMs: 0,
          model: 'grounded-fallback',
          modelUsed: 'grounded-fallback',
          geminiAttempts: cascadeDiagnostics.length,
          geminiCalls: cascadeDiagnostics.length,
          parseValidationMs: 0
        }
      };
    } catch (fallbackError: any) {
      console.error(`[Fallback Generation Failed][${correlationId}]:`, fallbackError);
      throw new Error('Travel planning service is temporarily unable to generate your plan. Please check your inputs and try again.');
    }
  }
}
