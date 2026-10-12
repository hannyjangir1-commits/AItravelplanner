import type { TravelPlan, TripFormData, UserProfile, ItinerarySummary, SavedItineraryDetail } from './types';
import { validateAndSanitizeTravelPlan } from './storage';

/**
 * Standardized, safe API client error with status code metadata and error categorizations.
 */
export class ApiClientError extends Error {
  public status: number;
  public code?: string;
  public isNetworkError: boolean;
  public isAuthError: boolean;
  public isRateLimit: boolean;
  public isNotFound: boolean;
  public isValidationError: boolean;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      isNetworkError?: boolean;
      isNotFound?: boolean;
    }
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options?.status ?? 0;
    this.code = options?.code;
    this.isNetworkError = Boolean(options?.isNetworkError);
    this.isAuthError = this.status === 401 || this.status === 403;
    this.isRateLimit = this.status === 429;
    this.isNotFound = Boolean(options?.isNotFound || this.status === 404);
    this.isValidationError = this.status === 400;
  }
}

export type AuthApiError = ApiClientError;

/**
 * Reads the anti-CSRF token from the travelgenie_csrf cookie.
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)travelgenie_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

let csrfPromise: Promise<string | null> | null = null;

/**
 * Ensures a valid CSRF token is available in document.cookie.
 * If missing, makes an in-flight deduplicated GET request to /api/auth/csrf.
 */
export async function ensureCsrfToken(signal?: AbortSignal): Promise<string | null> {
  const existing = getCsrfToken();
  if (existing) return existing;

  if (!csrfPromise) {
    csrfPromise = (async () => {
      try {
        const res = await fetch('/api/auth/csrf', {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
          signal
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        return (typeof data?.csrfToken === 'string' && data.csrfToken) ? data.csrfToken : getCsrfToken();
      } catch {
        return null;
      } finally {
        csrfPromise = null;
      }
    })();
  }
  return csrfPromise;
}

/**
 * Builds standard JSON headers including anti-CSRF token.
 */
export async function getJsonHeaders(
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extraHeaders
  };
  const token = await ensureCsrfToken(signal);
  if (token) {
    headers['X-CSRF-Token'] = token;
  }
  return headers;
}

/**
 * Safely parses response JSON body, distinguishing empty responses and malformed payloads.
 */
export async function parseResponseJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiClientError(
      `Received an unexpected non-JSON response from server (Status ${res.status}).`,
      { status: res.status }
    );
  }
}

/**
 * Maps HTTP status codes and backend error messages to safe user-friendly errors.
 */
export function handleHttpError(res: Response, data: any): never {
  const serverMsg = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : null;
  const code = typeof data?.code === 'string' ? data.code : undefined;
  const notFound = Boolean(data?.notFound || res.status === 404);

  let message = serverMsg;
  if (!message) {
    if (res.status === 400) message = 'Invalid request. Please check your inputs and try again.';
    else if (res.status === 401) message = 'Authentication required. Please sign in to continue.';
    else if (res.status === 403) message = 'Session validation or security check failed. Please refresh the page.';
    else if (res.status === 404) message = 'The requested resource was not found.';
    else if (res.status === 409) message = 'A conflict occurred. The resource already exists.';
    else if (res.status === 429) message = 'Rate limit reached. Please wait a moment before trying again.';
    else if (res.status >= 500) message = 'The travel planning service is temporarily unavailable. Please try again shortly.';
    else message = `Request failed with status ${res.status}.`;
  }

  throw new ApiClientError(message, {
    status: res.status,
    code,
    isNotFound: notFound
  });
}

function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Runtime validation for UserProfile response payloads.
 */
export function validateUserProfile(data: unknown): UserProfile | null {
  if (!isPlainObject(data)) return null;
  if (typeof data.id !== 'string' || !data.id.trim()) return null;
  if (typeof data.username !== 'string' || !data.username.trim()) return null;
  return {
    id: data.id.trim(),
    username: data.username.trim(),
    name: typeof data.name === 'string' ? data.name : null,
    email: typeof data.email === 'string' ? data.email : null,
    profilePicture: typeof data.profilePicture === 'string' ? data.profilePicture : null,
    place: typeof data.place === 'string' ? data.place : null
  };
}

/**
 * Runtime validation for ItinerarySummary list response payloads.
 */
export function validateItinerarySummaries(data: unknown): ItinerarySummary[] {
  if (!Array.isArray(data)) return [];
  const results: ItinerarySummary[] = [];
  for (const item of data) {
    if (!isPlainObject(item)) continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (typeof item.destination !== 'string' || !item.destination.trim()) continue;
    const numberOfDays = Number(item.numberOfDays);
    const numberOfTravellers = Number(item.numberOfTravellers);
    if (isNaN(numberOfDays) || numberOfDays < 1) continue;
    if (isNaN(numberOfTravellers) || numberOfTravellers < 1) continue;
    results.push({
      id: item.id.trim(),
      destination: item.destination.trim(),
      numberOfDays,
      numberOfTravellers,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
    });
  }
  return results;
}

/**
 * Runtime validation for SavedItineraryDetail response payloads.
 */
export function validateSavedItineraryDetail(data: unknown): SavedItineraryDetail | null {
  if (!isPlainObject(data)) return null;
  if (typeof data.id !== 'string' || !data.id.trim()) return null;
  if (typeof data.destination !== 'string' || !data.destination.trim()) return null;
  const numDays = Number(data.numberOfDays);
  const budget = Number(data.budgetInr);
  const travellers = Number(data.numberOfTravellers);
  if (isNaN(numDays) || numDays < 1) return null;
  if (isNaN(budget) || budget <= 0) return null;
  if (isNaN(travellers) || travellers < 1) return null;

  const validAccommodations = ['Budget', 'Moderate', 'Premium'] as const;
  const accommodationPreference = validAccommodations.includes(data.accommodationPreference)
    ? data.accommodationPreference
    : 'Moderate';

  const validActivities = ['Relaxed', 'Moderate', 'Active'] as const;
  const activityLevel = validActivities.includes(data.activityLevel)
    ? data.activityLevel
    : 'Moderate';

  const interests = Array.isArray(data.interests)
    ? data.interests.filter((i) => typeof i === 'string')
    : [];

  const validatedPlan = validateAndSanitizeTravelPlan(data.plan);
  if (!validatedPlan) return null;

  return {
    id: data.id.trim(),
    destination: data.destination.trim(),
    numberOfDays: numDays,
    budgetInr: budget,
    numberOfTravellers: travellers,
    interests,
    accommodationPreference,
    activityLevel,
    additionalNotes: typeof data.additionalNotes === 'string' ? data.additionalNotes : null,
    includeDayByDayItinerary: typeof data.includeDayByDayItinerary === 'boolean'
      ? data.includeDayByDayItinerary
      : validatedPlan.includeDayByDayItinerary,
    plan: validatedPlan,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
  };
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export async function generateTravelPlan(
  formData: TripFormData,
  options?: RequestOptions
): Promise<{
  plan: TravelPlan;
  id?: string;
  createdAt?: string;
  isDemo: boolean;
  message?: string;
}> {
  const payload = {
    destination: formData.destination.trim(),
    numberOfDays: Number(formData.numberOfDays),
    budgetInr: Number(formData.budgetInr),
    numberOfTravellers: Number(formData.numberOfTravellers),
    interests: formData.interests,
    accommodationPreference: formData.accommodationPreference,
    activityLevel: formData.activityLevel,
    additionalNotes: formData.additionalNotes.trim() || undefined,
    includeDayByDayItinerary: formData.includeDayByDayItinerary !== undefined ? formData.includeDayByDayItinerary : true
  };

  const headers = await getJsonHeaders({}, options?.signal);
  let response: Response;
  try {
    response = await fetch('/api/generate-travel-plan', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    throw new ApiClientError(
      'Unable to connect to the travel planning service. Please verify your network connection.',
      { isNetworkError: true }
    );
  }

  const data = await parseResponseJson(response);
  if (!response.ok || !data?.data) {
    handleHttpError(response, data);
  }

  const validatedPlan = validateAndSanitizeTravelPlan(data.data);
  if (!validatedPlan) {
    throw new ApiClientError('Server returned an invalid or malformed travel plan format.');
  }

  return {
    plan: {
      ...validatedPlan,
      generatedAt: validatedPlan.generatedAt || new Date().toISOString()
    },
    id: typeof data.id === 'string' ? data.id : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    isDemo: Boolean(data.isDemo),
    message: typeof data.message === 'string' ? data.message : undefined
  };
}

export async function modifyTravelPlan(
  originalDetails: TripFormData,
  currentPlan: TravelPlan,
  modificationRequest: string,
  itineraryId?: string,
  options?: RequestOptions
): Promise<{
  plan: TravelPlan;
  id?: string;
  updatedAt?: string;
  isDemo: boolean;
  message?: string;
}> {
  const payload: any = {
    originalDetails: {
      destination: originalDetails.destination.trim(),
      numberOfDays: Number(originalDetails.numberOfDays),
      budgetInr: Number(originalDetails.budgetInr),
      numberOfTravellers: Number(originalDetails.numberOfTravellers),
      interests: originalDetails.interests,
      accommodationPreference: originalDetails.accommodationPreference,
      activityLevel: originalDetails.activityLevel,
      additionalNotes: originalDetails.additionalNotes.trim() || undefined,
      includeDayByDayItinerary: originalDetails.includeDayByDayItinerary !== undefined ? originalDetails.includeDayByDayItinerary : true
    },
    currentPlan,
    modificationRequest: modificationRequest.trim()
  };

  if (itineraryId) {
    payload.itineraryId = itineraryId;
  }

  const headers = await getJsonHeaders({}, options?.signal);
  let response: Response;
  try {
    response = await fetch('/api/modify-travel-plan', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    throw new ApiClientError(
      'Unable to connect to the travel planning service. Please verify your network connection.',
      { isNetworkError: true }
    );
  }

  const data = await parseResponseJson(response);
  if (!response.ok || !data?.data) {
    handleHttpError(response, data);
  }

  const validatedPlan = validateAndSanitizeTravelPlan(data.data);
  if (!validatedPlan) {
    throw new ApiClientError('Server returned an invalid or malformed updated travel plan.');
  }

  return {
    plan: {
      ...validatedPlan,
      generatedAt: validatedPlan.generatedAt || new Date().toISOString()
    },
    id: typeof data.id === 'string' ? data.id : itineraryId,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    isDemo: Boolean(data.isDemo),
    message: typeof data.message === 'string' ? data.message : undefined
  };
}

export async function signupUser(
  username: string,
  password: string,
  options?: RequestOptions
): Promise<UserProfile> {
  const headers = await getJsonHeaders({}, options?.signal);
  let response: Response;
  try {
    response = await fetch('/api/auth/signup', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ username, password }),
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiClientError(
      'Unable to connect to the authentication service. Please verify your network connection.',
      { isNetworkError: true }
    );
  }

  const data = await parseResponseJson(response);
  if (!response.ok || !data?.authenticated || !data?.user) {
    handleHttpError(response, data);
  }

  const validatedUser = validateUserProfile(data.user);
  if (!validatedUser) {
    throw new ApiClientError('Server returned an invalid user profile format.');
  }

  return validatedUser;
}

export async function loginUser(
  username: string,
  password: string,
  options?: RequestOptions
): Promise<UserProfile> {
  const headers = await getJsonHeaders({}, options?.signal);
  let response: Response;
  try {
    response = await fetch('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ username, password }),
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiClientError(
      'Unable to connect to the authentication service. Please verify your network connection.',
      { isNetworkError: true }
    );
  }

  const data = await parseResponseJson(response);
  if (!response.ok || !data?.authenticated || !data?.user) {
    handleHttpError(response, data);
  }

  const validatedUser = validateUserProfile(data.user);
  if (!validatedUser) {
    throw new ApiClientError('Server returned an invalid user profile format.');
  }

  return validatedUser;
}

export async function fetchCurrentUser(options?: RequestOptions): Promise<UserProfile | null> {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      },
      signal: options?.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = await parseResponseJson(response);
    if (data?.authenticated && data?.user) {
      return validateUserProfile(data.user);
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateUserProfile(
  payload: { name?: string; place?: string },
  options?: RequestOptions
): Promise<UserProfile> {
  const headers = await getJsonHeaders({}, options?.signal);
  let response: Response;
  try {
    response = await fetch('/api/auth/profile', {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiClientError(
      'Unable to connect to the profile service. Please verify your network connection.',
      { isNetworkError: true }
    );
  }

  const data = await parseResponseJson(response);
  if (!response.ok || !data?.authenticated || !data?.user) {
    handleHttpError(response, data);
  }

  const validatedUser = validateUserProfile(data.user);
  if (!validatedUser) {
    throw new ApiClientError('Server returned an invalid updated profile format.');
  }

  return validatedUser;
}

export async function logoutUser(options?: RequestOptions): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    const csrf = getCsrfToken();
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers,
      signal: options?.signal
    });
  } catch (error) {
    console.error('[Logout API Error]:', error);
  }
}

export async function fetchTravelPlans(options?: RequestOptions): Promise<ItinerarySummary[]> {
  let response: Response;
  try {
    response = await fetch('/api/travel-plans', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      },
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiClientError('Unable to load previous itineraries. Please check your network.', {
      isNetworkError: true
    });
  }

  const data = await parseResponseJson(response);
  if (!response.ok) {
    handleHttpError(response, data);
  }

  return validateItinerarySummaries(data?.itineraries);
}

export async function fetchTravelPlanById(
  id: string,
  options?: RequestOptions
): Promise<SavedItineraryDetail> {
  let response: Response;
  try {
    response = await fetch(`/api/travel-plans/${encodeURIComponent(id)}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      },
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiClientError('Unable to load itinerary. Please check your network connection.', {
      isNetworkError: true
    });
  }

  const data = await parseResponseJson(response);
  if (!response.ok) {
    handleHttpError(response, data);
  }

  const validatedDetail = validateSavedItineraryDetail(data?.itinerary);
  if (!validatedDetail) {
    throw new ApiClientError('Itinerary data is missing or corrupted.');
  }

  return validatedDetail;
}

export async function deleteTravelPlan(
  id: string,
  options?: RequestOptions
): Promise<void> {
  const headers = await getJsonHeaders({}, options?.signal);
  let response: Response;
  try {
    response = await fetch(`/api/travel-plans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
      signal: options?.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiClientError('Unable to connect to the travel planning service. Please verify your connection.', {
      isNetworkError: true
    });
  }

  if (!response.ok) {
    const data = await parseResponseJson(response);
    handleHttpError(response, data);
  }
}
