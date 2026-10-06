import type { TravelPlan, TripFormData, PlaceToVisit, FoodOrExperience, Activity, DayPlan, AccommodationType, ActivityLevelType } from './types';

export const STORAGE_KEY_PLAN = 'aitravel_plan';
export const STORAGE_KEY_DETAILS = 'aitravel_details';
export const STORAGE_KEY_JUST_MODIFIED = 'aitravel_just_modified';
export const STORAGE_KEY_IS_DEMO = 'aitravel_is_demo';
export const STORAGE_KEY_MESSAGE = 'aitravel_message';

export const APP_STORAGE_KEYS = [
  STORAGE_KEY_PLAN,
  STORAGE_KEY_DETAILS,
  STORAGE_KEY_JUST_MODIFIED,
  STORAGE_KEY_IS_DEMO,
  STORAGE_KEY_MESSAGE
] as const;

export interface StoredSessionState {
  plan: TravelPlan | null;
  details: TripFormData | null;
  isDemo: boolean;
  message: string | null;
}

function isObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Validates that data has the required TravelPlan structure and sanitizes fields.
 * Returns null if data is corrupt, incomplete, or not a TravelPlan.
 */
export function validateAndSanitizeTravelPlan(data: unknown): TravelPlan | null {
  if (!isObject(data)) {
    return null;
  }

  // Must have day itinerary as an array with at least 1 day
  if (!Array.isArray(data.itinerary) || data.itinerary.length === 0) {
    return null;
  }

  // Check each day plan in itinerary
  const sanitizedItinerary: DayPlan[] = [];
  for (const day of data.itinerary) {
    if (!isObject(day)) {
      return null;
    }
    const dayNum = Number(day.day);
    if (isNaN(dayNum) || dayNum <= 0) {
      return null;
    }
    sanitizedItinerary.push({
      day: dayNum,
      morning: typeof day.morning === 'string' ? day.morning : '',
      afternoon: typeof day.afternoon === 'string' ? day.afternoon : '',
      evening: typeof day.evening === 'string' ? day.evening : '',
      notes: typeof day.notes === 'string' ? day.notes : '',
      alternative: typeof day.alternative === 'string' ? day.alternative : ''
    });
  }

  // Sanitize placesToVisit
  const placesToVisit: PlaceToVisit[] = Array.isArray(data.placesToVisit)
    ? data.placesToVisit
        .filter(isObject)
        .map((p) => ({
          name: typeof p.name === 'string' ? p.name : 'Attraction',
          reason: typeof p.reason === 'string' ? p.reason : '',
          bestTime: typeof p.bestTime === 'string' ? p.bestTime : ''
        }))
    : [];

  // Sanitize foodAndLocalExperiences
  const foodAndLocalExperiences: FoodOrExperience[] = Array.isArray(data.foodAndLocalExperiences)
    ? data.foodAndLocalExperiences
        .filter(isObject)
        .map((f) => ({
          name: typeof f.name === 'string' ? f.name : 'Local Specialty',
          reason: typeof f.reason === 'string' ? f.reason : ''
        }))
    : [];

  // Sanitize activities
  const activities: Activity[] = Array.isArray(data.activities)
    ? data.activities
        .filter(isObject)
        .map((a) => ({
          name: typeof a.name === 'string' ? a.name : 'Activity',
          reason: typeof a.reason === 'string' ? a.reason : ''
        }))
    : [];

  // Sanitize budgetTips
  const budgetTips: string[] = Array.isArray(data.budgetTips)
    ? data.budgetTips.filter((t) => typeof t === 'string')
    : [];

  const accommodationGuidance =
    typeof data.accommodationGuidance === 'string' && data.accommodationGuidance.trim() !== ''
      ? data.accommodationGuidance
      : 'Recommended accommodation guidance provided for destination.';

  const weatherAdvice =
    typeof data.weatherAdvice === 'string' && data.weatherAdvice.trim() !== ''
      ? data.weatherAdvice
      : 'Check seasonal weather forecasts before departure.';

  const generatedAt =
    typeof data.generatedAt === 'string' && data.generatedAt.trim() !== ''
      ? data.generatedAt
      : undefined;

  return {
    accommodationGuidance,
    placesToVisit,
    foodAndLocalExperiences,
    activities,
    weatherAdvice,
    budgetTips,
    itinerary: sanitizedItinerary,
    generatedAt
  };
}

/**
 * Validates that data has the required TripFormData structure.
 * Returns null if data is corrupt, incomplete, or invalid.
 */
export function validateAndSanitizeTripDetails(data: unknown): TripFormData | null {
  if (!isObject(data)) {
    return null;
  }

  // destination must be a non-empty string
  if (typeof data.destination !== 'string' || data.destination.trim() === '') {
    return null;
  }

  const numDays = Number(data.numberOfDays);
  if (isNaN(numDays) || numDays < 1 || numDays > 30) {
    return null;
  }

  const budget = Number(data.budgetInr);
  if (isNaN(budget) || budget <= 0) {
    return null;
  }

  const travellers = Number(data.numberOfTravellers);
  if (isNaN(travellers) || travellers < 1 || travellers > 20) {
    return null;
  }

  const validAccommodations: AccommodationType[] = ['Budget', 'Moderate', 'Premium'];
  const accommodationPreference: AccommodationType = validAccommodations.includes(data.accommodationPreference)
    ? data.accommodationPreference
    : 'Moderate';

  const validActivities: ActivityLevelType[] = ['Relaxed', 'Moderate', 'Active'];
  const activityLevel: ActivityLevelType = validActivities.includes(data.activityLevel)
    ? data.activityLevel
    : 'Moderate';

  const interests = Array.isArray(data.interests)
    ? data.interests.filter((i) => typeof i === 'string')
    : [];

  const additionalNotes = typeof data.additionalNotes === 'string'
    ? data.additionalNotes
    : '';

  return {
    destination: data.destination.trim(),
    numberOfDays: numDays,
    budgetInr: budget,
    numberOfTravellers: travellers,
    interests,
    accommodationPreference,
    activityLevel,
    additionalNotes
  };
}

/**
 * Safely clears only the application's sessionStorage keys without affecting other keys.
 */
export function clearAppSessionStorage(): void {
  try {
    for (const key of APP_STORAGE_KEYS) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Gracefully handle storage errors
  }
}

/**
 * Safely loads and validates the stored session.
 * If data is corrupt or incomplete, clears only the affected keys and returns an empty state.
 */
export function loadStoredSession(): StoredSessionState {
  const emptyState: StoredSessionState = {
    plan: null,
    details: null,
    isDemo: false,
    message: null
  };

  try {
    const rawPlan = sessionStorage.getItem(STORAGE_KEY_PLAN);
    const rawDetails = sessionStorage.getItem(STORAGE_KEY_DETAILS);

    // If neither exists, clean initial state
    if (!rawPlan && !rawDetails) {
      return emptyState;
    }

    // Incomplete data: one exists without the other
    if (!rawPlan || !rawDetails) {
      clearAppSessionStorage();
      return emptyState;
    }

    let parsedPlanJson: unknown;
    let parsedDetailsJson: unknown;

    try {
      parsedPlanJson = JSON.parse(rawPlan);
      parsedDetailsJson = JSON.parse(rawDetails);
    } catch {
      // Malformed JSON syntax
      clearAppSessionStorage();
      return emptyState;
    }

    const validatedPlan = validateAndSanitizeTravelPlan(parsedPlanJson);
    const validatedDetails = validateAndSanitizeTripDetails(parsedDetailsJson);

    if (!validatedPlan || !validatedDetails) {
      // Schema / structure mismatch or missing required content
      clearAppSessionStorage();
      return emptyState;
    }

    const isDemo = sessionStorage.getItem(STORAGE_KEY_IS_DEMO) === 'true';
    const message = sessionStorage.getItem(STORAGE_KEY_MESSAGE) || null;

    return {
      plan: validatedPlan,
      details: validatedDetails,
      isDemo,
      message
    };
  } catch {
    return emptyState;
  }
}

/**
 * Saves current plan, details, and demo metadata into sessionStorage.
 */
export function saveAppSessionStorage(
  plan: TravelPlan,
  details: TripFormData,
  isDemo: boolean,
  message?: string | null
): void {
  try {
    sessionStorage.setItem(STORAGE_KEY_PLAN, JSON.stringify(plan));
    sessionStorage.setItem(STORAGE_KEY_DETAILS, JSON.stringify(details));
    sessionStorage.setItem(STORAGE_KEY_IS_DEMO, String(isDemo));
    if (message) {
      sessionStorage.setItem(STORAGE_KEY_MESSAGE, message);
    } else {
      sessionStorage.removeItem(STORAGE_KEY_MESSAGE);
    }
  } catch (err) {
    console.warn('Unable to persist travel plan session:', err);
  }
}

/**
 * Sets the modification reload flag in sessionStorage.
 */
export function setJustModifiedFlag(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY_JUST_MODIFIED, 'true');
  } catch {
    // Ignore storage errors
  }
}

/**
 * Checks and clears the modification reload flag.
 */
export function checkAndClearJustModifiedFlag(): boolean {
  try {
    const val = sessionStorage.getItem(STORAGE_KEY_JUST_MODIFIED);
    if (val === 'true') {
      sessionStorage.removeItem(STORAGE_KEY_JUST_MODIFIED);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
