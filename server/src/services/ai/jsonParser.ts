import { TravelPlan } from '../../types.js';

/**
 * Extracts the first complete top-level JSON object by counting matching braces.
 * This guarantees any trailing commentary, markdown ticks, or text from the model are ignored.
 */
export function extractBalancedJsonObject(text: string): string {
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
 * Safely redact API key from error strings and log messages.
 * Matches both the specific active key and general Google API key patterns (AIza...).
 */
export function redactApiKey(message: string, key?: string): string {
  if (!message) return message;
  let sanitized = String(message);
  if (key) {
    sanitized = sanitized.split(key).join('[REDACTED_API_KEY]');
  }
  // Sanitize any key= or apiKey= query param or header in URLs
  sanitized = sanitized.replace(/((?:key|apiKey)=)[^\s&"']+/gi, '$1[REDACTED_API_KEY]');
  // Sanitize any Google API key pattern (AIza...) of standard or variable length
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{10,60}/g, '[REDACTED_API_KEY]');
  return sanitized;
}

export interface CleanAndParseOptions {
  requireItinerary?: boolean;
  expectedDays?: number;
}

/**
 * Clean and parse JSON from AI response, removing any markdown code blocks and trailing noise.
 * Safely accepts itinerary: [] when requireItinerary is false.
 */
export function cleanAndParseJSON(
  rawText: string,
  options: CleanAndParseOptions = {}
): TravelPlan {
  if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
    throw new Error('AI response is empty or non-string.');
  }

  let cleaned = rawText.trim();
  
  // Extract strictly between opening { and its corresponding matching }
  cleaned = extractBalancedJsonObject(cleaned);

  // Remove possible trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Failed to parse AI response as valid JSON: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI response JSON is not a valid structured object.');
  }

  const shouldRequireItinerary = options.requireItinerary !== false;

  if (shouldRequireItinerary) {
    if (!Array.isArray(parsed.itinerary) || parsed.itinerary.length === 0) {
      throw new Error('AI response did not contain a valid itinerary schedule array.');
    }
    if (options.expectedDays && parsed.itinerary.length !== options.expectedDays) {
      throw new Error(
        `AI response returned ${parsed.itinerary.length} day(s) of itinerary schedule, but ${options.expectedDays} day(s) were requested.`
      );
    }
  } else {
    if (!Array.isArray(parsed.itinerary)) {
      parsed.itinerary = [];
    }
    parsed.includeDayByDayItinerary = false;
  }

  // Validate and provide defaults for critical fields
  if (!parsed.placesToVisit || !Array.isArray(parsed.placesToVisit)) parsed.placesToVisit = [];
  if (!parsed.foodAndLocalExperiences || !Array.isArray(parsed.foodAndLocalExperiences)) parsed.foodAndLocalExperiences = [];
  if (!parsed.activities || !Array.isArray(parsed.activities)) parsed.activities = [];
  if (!parsed.budgetTips || !Array.isArray(parsed.budgetTips)) parsed.budgetTips = [];
  if (!parsed.accommodationGuidance) parsed.accommodationGuidance = 'Recommended stay options provided for the destination.';
  if (!parsed.weatherAdvice) parsed.weatherAdvice = 'Check local destination forecasts prior to your arrival.';

  // Normalize place items and preserve verifiedPlaceId and verification fields
  parsed.placesToVisit = parsed.placesToVisit
    .filter((p: any) => p && typeof p === 'object' && typeof p.name === 'string')
    .map((p: any) => ({
      verifiedPlaceId: typeof p.verifiedPlaceId === 'string' && p.verifiedPlaceId.trim() ? p.verifiedPlaceId.trim() : (p.verifiedPlaceId === null ? null : undefined),
      name: p.name.trim(),
      reason: typeof p.reason === 'string' ? p.reason.trim() : '',
      bestTime: typeof p.bestTime === 'string' ? p.bestTime.trim() : '',
      verificationStatus: p.verificationStatus === 'verified' ? 'verified' : (p.verificationStatus === 'unverified' ? 'unverified' : undefined),
      source: p.source === 'catalog' ? 'catalog' : (p.source === 'ai_suggestion' ? 'ai_suggestion' : undefined)
    }));

  parsed.foodAndLocalExperiences = parsed.foodAndLocalExperiences
    .filter((f: any) => f && typeof f === 'object' && typeof f.name === 'string')
    .map((f: any) => ({
      verifiedPlaceId: typeof f.verifiedPlaceId === 'string' && f.verifiedPlaceId.trim() ? f.verifiedPlaceId.trim() : (f.verifiedPlaceId === null ? null : undefined),
      name: f.name.trim(),
      reason: typeof f.reason === 'string' ? f.reason.trim() : '',
      verificationStatus: f.verificationStatus === 'verified' ? 'verified' : (f.verificationStatus === 'unverified' ? 'unverified' : undefined),
      source: f.source === 'catalog' ? 'catalog' : (f.source === 'ai_suggestion' ? 'ai_suggestion' : undefined)
    }));

  parsed.activities = parsed.activities
    .filter((a: any) => a && typeof a === 'object' && typeof a.name === 'string')
    .map((a: any) => ({
      verifiedPlaceId: typeof a.verifiedPlaceId === 'string' && a.verifiedPlaceId.trim() ? a.verifiedPlaceId.trim() : (a.verifiedPlaceId === null ? null : undefined),
      name: a.name.trim(),
      reason: typeof a.reason === 'string' ? a.reason.trim() : '',
      verificationStatus: a.verificationStatus === 'verified' ? 'verified' : (a.verificationStatus === 'unverified' ? 'unverified' : undefined),
      source: a.source === 'catalog' ? 'catalog' : (a.source === 'ai_suggestion' ? 'ai_suggestion' : undefined)
    }));

  if (shouldRequireItinerary) {
    for (let i = 0; i < parsed.itinerary.length; i++) {
      const d = parsed.itinerary[i];
      if (!d || typeof d !== 'object' || Array.isArray(d)) {
        throw new Error(`AI response contains an invalid day structure at day ${i + 1}.`);
      }
    }
    parsed.itinerary = parsed.itinerary.map((d: any, idx: number) => ({
      day: Number(d.day) || (idx + 1),
      morning: typeof d.morning === 'string' ? d.morning.trim() : '',
      morningPlaceId: typeof d.morningPlaceId === 'string' && d.morningPlaceId.trim() ? d.morningPlaceId.trim() : undefined,
      afternoon: typeof d.afternoon === 'string' ? d.afternoon.trim() : '',
      afternoonPlaceId: typeof d.afternoonPlaceId === 'string' && d.afternoonPlaceId.trim() ? d.afternoonPlaceId.trim() : undefined,
      evening: typeof d.evening === 'string' ? d.evening.trim() : '',
      eveningPlaceId: typeof d.eveningPlaceId === 'string' && d.eveningPlaceId.trim() ? d.eveningPlaceId.trim() : undefined,
      notes: typeof d.notes === 'string' ? d.notes.trim() : '',
      alternative: typeof d.alternative === 'string' ? d.alternative.trim() : ''
    }));
    parsed.includeDayByDayItinerary = true;
  } else {
    parsed.itinerary = [];
    parsed.includeDayByDayItinerary = false;
  }

  return parsed as TravelPlan;
}
