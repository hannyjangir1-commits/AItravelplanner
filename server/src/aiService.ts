/**
 * TravelGenie — AI & Travel Planning Facade
 * Provides unified access to Gemini AI integration, grounded fallback synthesizer,
 * and conversational travel-planning engine.
 */

export {
  redactApiKey,
  cleanAndParseJSON,
  type CleanAndParseOptions
} from './services/ai/jsonParser.js';

export {
  GEMINI_MODELS,
  type GeminiModelName,
  type GeminiCallMetrics,
  type CallGeminiOptions,
  type CallGeminiResult,
  callGemini
} from './services/ai/geminiClient.js';

export {
  generateCatalogGroundedFallback
} from './services/planner/fallbackGenerator.js';

export {
  type GeneratePlanServiceOptions,
  type GeneratePlanServiceResult,
  generateTravelPlanService
} from './services/planner/planGenerator.js';

export {
  validateAndMergeModifiedPlan,
  modifyTravelPlanService
} from './services/planner/planModifier.js';
