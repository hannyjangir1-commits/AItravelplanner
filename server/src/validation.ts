import { GeneratePlanRequest, ModifyPlanRequest, TravelPlan } from './types.js';

export interface ValidationResult<T> {
  isValid: boolean;
  data?: T;
  error?: string;
}

const VALID_ACCOMMODATION = ['Budget', 'Moderate', 'Premium'] as const;
const VALID_ACTIVITY = ['Relaxed', 'Moderate', 'Active'] as const;

/**
 * Validates and sanitizes a GeneratePlanRequest payload.
 * Enforces authoritative backend constraints independently of client-side validation.
 */
export function validateGeneratePlanRequest(input: any): ValidationResult<GeneratePlanRequest> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { isValid: false, error: 'Request body must be a valid JSON object.' };
  }

  // 1. Destination: required, non-empty string, max 150 chars
  const { destination } = input;
  if (!destination || typeof destination !== 'string' || destination.trim() === '') {
    return { isValid: false, error: 'Destination is required and must be a valid text string.' };
  }
  const cleanDestination = destination.trim();
  if (cleanDestination.length > 150) {
    return { isValid: false, error: 'Destination must not exceed 150 characters.' };
  }

  // 2. Number of Days: integer between 1 and 30
  const { numberOfDays } = input;
  if (numberOfDays === undefined || numberOfDays === null || numberOfDays === '') {
    return { isValid: false, error: 'Number of days is required.' };
  }
  const days = Number(numberOfDays);
  if (isNaN(days) || !Number.isInteger(days) || days < 1 || days > 30) {
    return { isValid: false, error: 'Number of days must be a whole number between 1 and 30.' };
  }

  // 3. Budget in INR: positive number
  const { budgetInr } = input;
  if (budgetInr === undefined || budgetInr === null || budgetInr === '') {
    return { isValid: false, error: 'Total budget in INR is required.' };
  }
  const budget = Number(budgetInr);
  if (isNaN(budget) || !isFinite(budget) || budget <= 0) {
    return { isValid: false, error: 'Total budget in INR must be a positive number.' };
  }
  if (budget > 100_000_000) {
    return { isValid: false, error: 'Total budget in INR must not exceed ₹10,00,00,000.' };
  }

  // 4. Number of Travellers: integer between 1 and 20
  const { numberOfTravellers } = input;
  if (numberOfTravellers === undefined || numberOfTravellers === null || numberOfTravellers === '') {
    return { isValid: false, error: 'Number of travellers is required.' };
  }
  const travellers = Number(numberOfTravellers);
  if (isNaN(travellers) || !Number.isInteger(travellers) || travellers < 1 || travellers > 20) {
    return { isValid: false, error: 'Number of travellers must be a whole number between 1 and 20.' };
  }

  // 5. Accommodation Preference: 'Budget' | 'Moderate' | 'Premium'
  let accommodation: 'Budget' | 'Moderate' | 'Premium' = 'Moderate';
  if (input.accommodationPreference !== undefined && input.accommodationPreference !== null) {
    if (!VALID_ACCOMMODATION.includes(input.accommodationPreference)) {
      return { isValid: false, error: "Accommodation preference must be 'Budget', 'Moderate', or 'Premium'." };
    }
    accommodation = input.accommodationPreference;
  }

  // 6. Activity Level: 'Relaxed' | 'Moderate' | 'Active'
  let activity: 'Relaxed' | 'Moderate' | 'Active' = 'Moderate';
  if (input.activityLevel !== undefined && input.activityLevel !== null) {
    if (!VALID_ACTIVITY.includes(input.activityLevel)) {
      return { isValid: false, error: "Activity level must be 'Relaxed', 'Moderate', or 'Active'." };
    }
    activity = input.activityLevel;
  }

  // 7. Interests: array of strings
  let cleanInterests: string[] = [];
  if (input.interests !== undefined && input.interests !== null) {
    if (!Array.isArray(input.interests)) {
      return { isValid: false, error: 'Interests must be an array of strings.' };
    }
    cleanInterests = input.interests
      .map((i: any) => String(i).trim())
      .filter((i: string) => i.length > 0 && i.length <= 50)
      .slice(0, 15);
  }

  // 8. Additional Notes: optional string, max 1000 chars
  let cleanNotes: string | undefined = undefined;
  if (input.additionalNotes !== undefined && input.additionalNotes !== null) {
    if (typeof input.additionalNotes !== 'string') {
      return { isValid: false, error: 'Additional notes must be a text string.' };
    }
    const trimmedNotes = input.additionalNotes.trim();
    if (trimmedNotes.length > 1000) {
      return { isValid: false, error: 'Additional notes must not exceed 1000 characters.' };
    }
    cleanNotes = trimmedNotes || undefined;
  }

  return {
    isValid: true,
    data: {
      destination: cleanDestination,
      numberOfDays: days,
      budgetInr: budget,
      numberOfTravellers: travellers,
      interests: cleanInterests,
      accommodationPreference: accommodation,
      activityLevel: activity,
      additionalNotes: cleanNotes
    }
  };
}

/**
 * Deeply validates and sanitizes currentPlan to prevent prompt bloat or nested injection.
 */
function sanitizeCurrentPlan(plan: any): TravelPlan | null {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return null;
  }

  if (!Array.isArray(plan.itinerary) || plan.itinerary.length < 1 || plan.itinerary.length > 30) {
    return null;
  }

  const sanitizedItinerary = [];
  for (let i = 0; i < plan.itinerary.length; i++) {
    const item = plan.itinerary[i];
    if (!item || typeof item !== 'object') {
      return null;
    }
    const dayNum = Number(item.day) || (i + 1);
    sanitizedItinerary.push({
      day: dayNum,
      morning: typeof item.morning === 'string' ? item.morning.slice(0, 2000) : '',
      afternoon: typeof item.afternoon === 'string' ? item.afternoon.slice(0, 2000) : '',
      evening: typeof item.evening === 'string' ? item.evening.slice(0, 2000) : '',
      notes: typeof item.notes === 'string' ? item.notes.slice(0, 1000) : '',
      alternative: typeof item.alternative === 'string' ? item.alternative.slice(0, 1000) : ''
    });
  }

  const placesToVisit = Array.isArray(plan.placesToVisit)
    ? plan.placesToVisit
        .filter((p: any) => p && typeof p === 'object')
        .slice(0, 30)
        .map((p: any) => ({
          name: typeof p.name === 'string' ? p.name.slice(0, 200) : 'Attraction',
          reason: typeof p.reason === 'string' ? p.reason.slice(0, 500) : '',
          bestTime: typeof p.bestTime === 'string' ? p.bestTime.slice(0, 200) : ''
        }))
    : [];

  const foodAndLocalExperiences = Array.isArray(plan.foodAndLocalExperiences)
    ? plan.foodAndLocalExperiences
        .filter((f: any) => f && typeof f === 'object')
        .slice(0, 30)
        .map((f: any) => ({
          name: typeof f.name === 'string' ? f.name.slice(0, 200) : 'Local Dish',
          reason: typeof f.reason === 'string' ? f.reason.slice(0, 500) : ''
        }))
    : [];

  const activities = Array.isArray(plan.activities)
    ? plan.activities
        .filter((a: any) => a && typeof a === 'object')
        .slice(0, 30)
        .map((a: any) => ({
          name: typeof a.name === 'string' ? a.name.slice(0, 200) : 'Activity',
          reason: typeof a.reason === 'string' ? a.reason.slice(0, 500) : ''
        }))
    : [];

  const budgetTips = Array.isArray(plan.budgetTips)
    ? plan.budgetTips
        .filter((t: any) => typeof t === 'string')
        .slice(0, 20)
        .map((t: string) => t.slice(0, 500))
    : [];

  const accommodationGuidance = typeof plan.accommodationGuidance === 'string'
    ? plan.accommodationGuidance.slice(0, 2000)
    : 'Recommended accommodation guidance provided.';

  const weatherAdvice = typeof plan.weatherAdvice === 'string'
    ? plan.weatherAdvice.slice(0, 2000)
    : 'Check seasonal weather forecasts before departure.';

  const generatedAt = typeof plan.generatedAt === 'string' ? plan.generatedAt.slice(0, 50) : undefined;

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
 * Validates and sanitizes a ModifyPlanRequest payload.
 * Reuses validateGeneratePlanRequest to ensure originalDetails are strictly valid.
 */
export function validateModifyPlanRequest(input: any): ValidationResult<ModifyPlanRequest> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { isValid: false, error: 'Request body must be a valid JSON object.' };
  }

  const { originalDetails, currentPlan, modificationRequest } = input;

  // 1. Modification Request: non-empty string, max 1000 chars
  if (!modificationRequest || typeof modificationRequest !== 'string' || modificationRequest.trim() === '') {
    return { isValid: false, error: 'Please enter a modification request (e.g. "Add more food places").' };
  }
  const cleanModRequest = modificationRequest.trim();
  if (cleanModRequest.length > 1000) {
    return { isValid: false, error: 'Modification request must not exceed 1000 characters.' };
  }

  // 2. Current Plan: must be structurally valid TravelPlan with 1-30 days
  const sanitizedPlan = sanitizeCurrentPlan(currentPlan);
  if (!sanitizedPlan) {
    return {
      isValid: false,
      error: 'Current travel plan must contain a valid itinerary schedule with 1 to 30 days.'
    };
  }

  // 3. Original Details: must satisfy GeneratePlanRequest schema
  const originalValidation = validateGeneratePlanRequest(originalDetails);
  if (!originalValidation.isValid || !originalValidation.data) {
    return {
      isValid: false,
      error: `Invalid original trip details: ${originalValidation.error}`
    };
  }

  return {
    isValid: true,
    data: {
      originalDetails: originalValidation.data,
      currentPlan: sanitizedPlan,
      modificationRequest: cleanModRequest
    }
  };
}
