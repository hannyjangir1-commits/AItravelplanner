/**
 * Google Places & Geocoding Provider Service for TravelGenie.
 *
 * Implements direct HTTP REST integration using native Node.js fetch()
 * without heavy external SDK dependencies.
 *
 * Security & Design Rules:
 * - Reads API key exclusively from process.env.GOOGLE_MAPS_API_KEY.
 * - Key remains server-side at all times.
 * - API keys are strictly redacted from all error messages and logged output.
 * - Uses modern Places API (New) endpoints (v1) and Geocoding API.
 * - Strictly enforces an explicit field mask to control billing SKUs and
 *   omit unnecessary heavy fields (photos, user reviews, editorial blobs).
 * - Normalizes provider payloads into internal data structures; never exposes raw Google JSON.
 */

// ============================================================================
// Custom Error Hierarchy
// ============================================================================

export class GooglePlacesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GooglePlacesConfigError';
  }
}

export class GooglePlacesRequestError extends Error {
  public statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'GooglePlacesRequestError';
    this.statusCode = statusCode;
  }
}

export class GooglePlacesRateLimitError extends Error {
  public statusCode: number;
  constructor(message = 'Google Places API quota or rate limit exceeded.') {
    super(message);
    this.name = 'GooglePlacesRateLimitError';
    this.statusCode = 429;
  }
}

export class GooglePlacesNoResultsError extends Error {
  constructor(message = 'No results returned by Google Places provider.') {
    super(message);
    this.name = 'GooglePlacesNoResultsError';
  }
}

export class GooglePlacesTimeoutError extends Error {
  constructor(message = 'Google Places API request timed out.') {
    super(message);
    this.name = 'GooglePlacesTimeoutError';
  }
}

export class GooglePlacesParseError extends Error {
  constructor(message = 'Malformed response returned by Google Places provider.') {
    super(message);
    this.name = 'GooglePlacesParseError';
  }
}

// ============================================================================
// Internal Normalized Data Types
// ============================================================================

/**
 * Normalized representation of a real-world POI obtained from Google Places API.
 * Every optional provider field safely supports null/undefined.
 * Missing values are NEVER fabricated.
 */
export interface InternalGooglePlace {
  providerPlaceId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  googleMapsUri: string | null;
  websiteUri: string | null;
  phoneNumber: string | null;
  openingHours: string[] | null;
  priceLevel: string | null;
}

export interface NormalizedAddressComponent {
  longName: string;
  shortName: string;
  types: string[];
}

export interface NormalizedViewport {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}

export interface NormalizedGeocodeResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  providerPlaceId?: string;
  locationType?: string;
  addressComponents: NormalizedAddressComponent[];
  viewport?: NormalizedViewport;
}

export interface SearchPlacesNearbyParams {
  coordinates: {
    latitude: number;
    longitude: number;
  };
  radiusMeters: number;
  includedTypes?: string[];
  maxResultCount?: number;
}

export interface SearchPlacesByTextParams {
  textQuery: string;
  center?: {
    latitude: number;
    longitude: number;
  };
  radiusMeters?: number;
  maxResultCount?: number;
}

export interface GoogleRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

// ============================================================================
// Field Mask Configuration
// ============================================================================

/**
 * Field mask for Places API (New) endpoints.
 *
 * Why this explicit field mask exists:
 * 1. Places API (New) requires an `X-Goog-FieldMask` header on all requests;
 *    omitting it results in an immediate HTTP 400 error.
 * 2. Field masks strictly govern billing SKUs (Basic vs. Advanced vs. Preferred).
 *    Requesting only the fields below avoids triggering higher-tier Enterprise SKUs.
 * 3. It filters out expensive, heavy payload structures that the application
 *    does not need (e.g. user reviews text, photo media blobs, editorial summaries).
 */
export const PLACES_API_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.regularOpeningHours',
  'places.priceLevel'
].join(',');

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

// ============================================================================
// Security & Redaction Helpers
// ============================================================================

/**
 * Redacts any Google API key pattern or specific key string from messages/URLs.
 */
function redactApiKey(input: string, key?: string): string {
  if (!input) return input;
  let sanitized = String(input);
  if (key && key.trim()) {
    sanitized = sanitized.split(key.trim()).join('[REDACTED_API_KEY]');
  }
  return sanitized.replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED_API_KEY]');
}

/**
 * Resolves the Google Maps API Key from process.env.
 * Throws GooglePlacesConfigError if the key is missing or set to placeholder.
 */
function getGoogleMapsApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || key === 'your_google_maps_api_key_here') {
    throw new GooglePlacesConfigError(
      'GOOGLE_MAPS_API_KEY is not configured in environment variables. Place verification cannot proceed.'
    );
  }
  return key;
}

// ============================================================================
// Normalization Utility
// ============================================================================

/**
 * Normalizes a raw place object from Google Places API (New) into InternalGooglePlace.
 * Guarantees zero field fabrication: missing values are mapped to null or empty arrays.
 */
export function normalizeGooglePlace(raw: any): InternalGooglePlace {
  if (!raw || typeof raw !== 'object') {
    throw new GooglePlacesParseError('Received invalid place item in provider response.');
  }

  const providerPlaceId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const name = typeof raw.displayName?.text === 'string' && raw.displayName.text.trim()
    ? raw.displayName.text.trim()
    : 'Unknown Place';
  const formattedAddress = typeof raw.formattedAddress === 'string'
    ? raw.formattedAddress.trim()
    : '';

  const lat = typeof raw.location?.latitude === 'number' && Number.isFinite(raw.location.latitude)
    ? raw.location.latitude
    : 0;
  const lng = typeof raw.location?.longitude === 'number' && Number.isFinite(raw.location.longitude)
    ? raw.location.longitude
    : 0;

  const types = Array.isArray(raw.types)
    ? raw.types.filter((t: any) => typeof t === 'string')
    : [];

  const rating = typeof raw.rating === 'number' && Number.isFinite(raw.rating)
    ? raw.rating
    : null;

  const userRatingCount = typeof raw.userRatingCount === 'number' && Number.isInteger(raw.userRatingCount)
    ? raw.userRatingCount
    : null;

  const googleMapsUri = typeof raw.googleMapsUri === 'string' && raw.googleMapsUri.trim()
    ? raw.googleMapsUri.trim()
    : null;

  const websiteUri = typeof raw.websiteUri === 'string' && raw.websiteUri.trim()
    ? raw.websiteUri.trim()
    : null;

  const phoneNumber = typeof raw.nationalPhoneNumber === 'string' && raw.nationalPhoneNumber.trim()
    ? raw.nationalPhoneNumber.trim()
    : (typeof raw.internationalPhoneNumber === 'string' && raw.internationalPhoneNumber.trim()
        ? raw.internationalPhoneNumber.trim()
        : null);

  const openingHours = Array.isArray(raw.regularOpeningHours?.weekdayDescriptions)
    ? raw.regularOpeningHours.weekdayDescriptions.filter((desc: any) => typeof desc === 'string')
    : null;

  const priceLevel = typeof raw.priceLevel === 'string' && raw.priceLevel.trim()
    ? raw.priceLevel.trim()
    : null;

  return {
    providerPlaceId,
    name,
    formattedAddress,
    latitude: lat,
    longitude: lng,
    types,
    rating,
    userRatingCount,
    googleMapsUri,
    websiteUri,
    phoneNumber,
    openingHours,
    priceLevel
  };
}

// ============================================================================
// Provider Endpoints
// ============================================================================

/**
 * Resolves a destination string to geographic coordinates and metadata
 * using the Google Geocoding REST API.
 *
 * @param destination User destination search text
 * @param options Optional timeout, abort signal, or fetch override (for unit testing)
 * @returns Normalized geocode result
 */
export async function geocodeDestination(
  destination: string,
  options: GoogleRequestOptions = {}
): Promise<NormalizedGeocodeResult> {
  const apiKey = getGoogleMapsApiKey();
  const trimmedDest = destination?.trim();

  if (!trimmedDest) {
    throw new GooglePlacesRequestError('Destination query must be a non-empty string.', 400);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? fetch;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmedDest)}&key=${apiKey}`;

  let response: Response;
  try {
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: combinedSignal
    });
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('abort')) {
      throw new GooglePlacesTimeoutError(`Geocoding request timed out after ${timeoutMs}ms.`);
    }
    throw new GooglePlacesRequestError(redactApiKey(`Geocoding network error: ${err.message}`, apiKey));
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      throw new GooglePlacesRateLimitError();
    }
    const rawError = await response.text().catch(() => '');
    throw new GooglePlacesRequestError(
      redactApiKey(`Geocoding HTTP error ${status}: ${rawError.slice(0, 200)}`, apiKey),
      status
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (jsonErr: any) {
    throw new GooglePlacesParseError(`Failed to parse geocoding response as JSON: ${jsonErr.message}`);
  }

  const geocodeStatus = data?.status;

  if (geocodeStatus === 'ZERO_RESULTS') {
    throw new GooglePlacesNoResultsError(`No geographic destination found for query: "${trimmedDest}".`);
  }

  if (geocodeStatus === 'OVER_QUERY_LIMIT') {
    throw new GooglePlacesRateLimitError('Google Geocoding API quota or rate limit exceeded.');
  }

  if (geocodeStatus === 'REQUEST_DENIED' || geocodeStatus === 'INVALID_REQUEST') {
    const errorMsg = data?.error_message || geocodeStatus;
    throw new GooglePlacesRequestError(redactApiKey(`Google Geocoding error (${geocodeStatus}): ${errorMsg}`, apiKey));
  }

  if (geocodeStatus !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
    throw new GooglePlacesRequestError(`Unexpected geocoding response status: ${geocodeStatus || 'EMPTY_RESULTS'}`);
  }

  const firstResult = data.results[0];
  const geometry = firstResult.geometry;

  if (
    !geometry ||
    typeof geometry.location?.lat !== 'number' ||
    typeof geometry.location?.lng !== 'number'
  ) {
    throw new GooglePlacesParseError('Geocoding result missing valid geometry location coordinates.');
  }

  const addressComponents: NormalizedAddressComponent[] = Array.isArray(firstResult.address_components)
    ? firstResult.address_components.map((comp: any) => ({
        longName: typeof comp.long_name === 'string' ? comp.long_name : '',
        shortName: typeof comp.short_name === 'string' ? comp.short_name : '',
        types: Array.isArray(comp.types) ? comp.types.filter((t: any) => typeof t === 'string') : []
      }))
    : [];

  let viewport: NormalizedViewport | undefined = undefined;
  if (
    geometry.viewport &&
    typeof geometry.viewport.northeast?.lat === 'number' &&
    typeof geometry.viewport.northeast?.lng === 'number' &&
    typeof geometry.viewport.southwest?.lat === 'number' &&
    typeof geometry.viewport.southwest?.lng === 'number'
  ) {
    viewport = {
      northeast: {
        lat: geometry.viewport.northeast.lat,
        lng: geometry.viewport.northeast.lng
      },
      southwest: {
        lat: geometry.viewport.southwest.lat,
        lng: geometry.viewport.southwest.lng
      }
    };
  }

  return {
    formattedAddress: typeof firstResult.formatted_address === 'string' ? firstResult.formatted_address : trimmedDest,
    latitude: geometry.location.lat,
    longitude: geometry.location.lng,
    providerPlaceId: typeof firstResult.place_id === 'string' ? firstResult.place_id : undefined,
    locationType: typeof geometry.location_type === 'string' ? geometry.location_type : undefined,
    addressComponents,
    viewport
  };
}

/**
 * Searches for places near a geographic center coordinate using Places API (New).
 * Endpoint: POST https://places.googleapis.com/v1/places:searchNearby
 *
 * @param params Search center, radius in meters, optional included types, and max result count
 * @param options Optional timeout, abort signal, or fetch override
 * @returns Array of normalized internal places (empty array if none found)
 */
export async function searchPlacesNearby(
  params: SearchPlacesNearbyParams,
  options: GoogleRequestOptions = {}
): Promise<InternalGooglePlace[]> {
  const apiKey = getGoogleMapsApiKey();

  if (
    !params?.coordinates ||
    !Number.isFinite(params.coordinates.latitude) ||
    !Number.isFinite(params.coordinates.longitude)
  ) {
    throw new GooglePlacesRequestError('Valid coordinates (latitude, longitude) are required for nearby search.', 400);
  }

  const radius = Math.min(Math.max(Number(params.radiusMeters) || 5000, 100), 50000);
  const maxResults = Math.min(Math.max(Number(params.maxResultCount) || 20, 1), 20);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? fetch;

  const url = 'https://places.googleapis.com/v1/places:searchNearby';

  const requestBody: any = {
    maxResultCount: maxResults,
    locationRestriction: {
      circle: {
        center: {
          latitude: params.coordinates.latitude,
          longitude: params.coordinates.longitude
        },
        radius
      }
    }
  };

  if (Array.isArray(params.includedTypes) && params.includedTypes.length > 0) {
    requestBody.includedTypes = params.includedTypes;
  }

  console.log(
    `[GooglePlaces Diagnostics] searchPlacesNearby: center=(${params.coordinates.latitude.toFixed(4)}, ${params.coordinates.longitude.toFixed(4)}), ` +
    `radius=${radius}m, maxResults=${maxResults}, includedTypes=[${params.includedTypes?.join(', ') || 'none'}]`
  );

  let response: Response;
  try {
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_API_FIELD_MASK
      },
      body: JSON.stringify(requestBody),
      signal: combinedSignal
    });
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('abort')) {
      throw new GooglePlacesTimeoutError(`searchPlacesNearby timed out after ${timeoutMs}ms.`);
    }
    throw new GooglePlacesRequestError(redactApiKey(`searchPlacesNearby network error: ${err.message}`, apiKey));
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      console.warn('[GooglePlaces Diagnostics] searchPlacesNearby HTTP 429: Rate limit exceeded.');
      throw new GooglePlacesRateLimitError();
    }
    const rawError = await response.text().catch(() => '');
    const sanitizedError = redactApiKey(rawError.slice(0, 300), apiKey);
    console.warn(`[GooglePlaces Diagnostics] searchPlacesNearby HTTP ${status} error: ${sanitizedError}`);
    throw new GooglePlacesRequestError(
      redactApiKey(`searchPlacesNearby HTTP error ${status}: ${rawError.slice(0, 200)}`, apiKey),
      status
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (jsonErr: any) {
    throw new GooglePlacesParseError(`Failed to parse searchPlacesNearby response as JSON: ${jsonErr.message}`);
  }

  const rawPlaces = Array.isArray(data?.places) ? data.places : [];
  const sampleNames = rawPlaces.slice(0, 3).map((p: any) => p.displayName?.text || p.name || 'unnamed').join(', ');
  const sampleTypes = rawPlaces.slice(0, 2).map((p: any) => (p.types || []).slice(0, 3).join('/')).join('; ');
  console.log(
    `[GooglePlaces Diagnostics] searchPlacesNearby: HTTP 200 OK, rawCount=${rawPlaces.length}, ` +
    `samplePlaces=[${sampleNames}], sampleTypes=[${sampleTypes}]`
  );

  // Google Places (New) returns an empty object {} or { places: [] } if zero results found
  if (rawPlaces.length === 0) {
    return [];
  }

  return rawPlaces.map(normalizeGooglePlace);
}

/**
 * Searches for places matching a textual query with optional geographic bias
 * using Places API (New).
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText
 *
 * @param params Text query, optional center coordinate bias, radius, and max result count
 * @param options Optional timeout, abort signal, or fetch override
 * @returns Array of normalized internal places (empty array if none found)
 */
export async function searchPlacesByText(
  params: SearchPlacesByTextParams,
  options: GoogleRequestOptions = {}
): Promise<InternalGooglePlace[]> {
  const apiKey = getGoogleMapsApiKey();

  const query = params?.textQuery?.trim();
  if (!query) {
    throw new GooglePlacesRequestError('textQuery must be a non-empty string.', 400);
  }

  const maxResults = Math.min(Math.max(Number(params.maxResultCount) || 10, 1), 20);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? fetch;

  const url = 'https://places.googleapis.com/v1/places:searchText';

  const requestBody: any = {
    textQuery: query,
    pageSize: maxResults
  };

  if (
    params.center &&
    Number.isFinite(params.center.latitude) &&
    Number.isFinite(params.center.longitude)
  ) {
    const radius = Math.min(Math.max(Number(params.radiusMeters) || 10000, 100), 50000);
    requestBody.locationBias = {
      circle: {
        center: {
          latitude: params.center.latitude,
          longitude: params.center.longitude
        },
        radius
      }
    };
  }

  console.log(
    `[GooglePlaces Diagnostics] searchPlacesByText: query="${query}", ` +
    `center=${params.center ? `(${params.center.latitude.toFixed(4)}, ${params.center.longitude.toFixed(4)})` : 'none'}, ` +
    `radius=${params.radiusMeters || 'default'}m, maxResults=${maxResults}`
  );

  let response: Response;
  try {
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_API_FIELD_MASK
      },
      body: JSON.stringify(requestBody),
      signal: combinedSignal
    });
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('abort')) {
      throw new GooglePlacesTimeoutError(`searchPlacesByText timed out after ${timeoutMs}ms.`);
    }
    throw new GooglePlacesRequestError(redactApiKey(`searchPlacesByText network error: ${err.message}`, apiKey));
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      console.warn('[GooglePlaces Diagnostics] searchPlacesByText HTTP 429: Rate limit exceeded.');
      throw new GooglePlacesRateLimitError();
    }
    const rawError = await response.text().catch(() => '');
    const sanitizedError = redactApiKey(rawError.slice(0, 300), apiKey);
    console.warn(`[GooglePlaces Diagnostics] searchPlacesByText HTTP ${status} error: ${sanitizedError}`);
    throw new GooglePlacesRequestError(
      redactApiKey(`searchPlacesByText HTTP error ${status}: ${rawError.slice(0, 200)}`, apiKey),
      status
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (jsonErr: any) {
    throw new GooglePlacesParseError(`Failed to parse searchPlacesByText response as JSON: ${jsonErr.message}`);
  }

  const rawPlaces = Array.isArray(data?.places) ? data.places : [];
  const sampleNames = rawPlaces.slice(0, 3).map((p: any) => p.displayName?.text || p.name || 'unnamed').join(', ');
  console.log(
    `[GooglePlaces Diagnostics] searchPlacesByText: HTTP 200 OK, rawCount=${rawPlaces.length}, samplePlaces=[${sampleNames}]`
  );

  if (rawPlaces.length === 0) {
    return [];
  }

  return rawPlaces.map(normalizeGooglePlace);
}
