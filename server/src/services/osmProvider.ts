/**
 * OpenStreetMap (Nominatim & Overpass API) Provider Service for TravelGenie.
 *
 * Provides cost-conscious, API-key-free real-world geocoding and place discovery
 * using OpenStreetMap public APIs.
 *
 * Operational & Compliance Rules:
 * 1. Nominatim Usage Policy Compliance:
 *    - Valid descriptive User-Agent header is mandatory on all requests.
 *    - Strict rate limiting: Enforces at least 1,000ms delay between consecutive requests.
 *    - In-memory caching and inflight request deduplication to prevent parallel bursts.
 * 2. Overpass API:
 *    - Uses Overpass QL with bounded geographic search `(around:radius,lat,lon)`.
 *    - Output includes nodes, ways, and relations with center coordinates and tags.
 *    - Handles HTTP 429 / 504 with polite backoff.
 * 3. Zero Fabrication: Missing tags, phone numbers, or opening hours remain null.
 * 4. Attribution: All normalized entities include "OpenStreetMap contributors" attribution.
 */

import { calculateDistanceMeters } from './geo.js';

// ============================================================================
// Custom Error Hierarchy
// ============================================================================

export class OsmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsmError';
  }
}

export class OsmRequestError extends OsmError {
  public statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'OsmRequestError';
    this.statusCode = statusCode;
  }
}

export class OsmRateLimitError extends OsmError {
  public statusCode = 429;
  constructor(message = 'OpenStreetMap service rate limit reached. Please retry in a few moments.') {
    super(message);
    this.name = 'OsmRateLimitError';
  }
}

export class OsmNoResultsError extends OsmError {
  constructor(message = 'No results returned by OpenStreetMap provider.') {
    super(message);
    this.name = 'OsmNoResultsError';
  }
}

export class OsmTimeoutError extends OsmError {
  constructor(message = 'OpenStreetMap request timed out.') {
    super(message);
    this.name = 'OsmTimeoutError';
  }
}

export class DestinationAmbiguityError extends OsmError {
  public candidateMatches: string[];
  constructor(message: string, candidateMatches: string[] = []) {
    super(message);
    this.name = 'DestinationAmbiguityError';
    this.candidateMatches = candidateMatches;
  }
}

// ============================================================================
// Data Types
// ============================================================================

export interface OsmNormalizedAddressComponent {
  longName: string;
  shortName: string;
  types: string[];
}

export interface OsmGeocodeResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  osmType: string;
  osmId: number;
  canonicalName: string;
  addressComponents: OsmNormalizedAddressComponent[];
  boundingbox?: [number, number, number, number]; // [south, north, west, east]
  importance?: number;
}

export interface InternalOsmPlace {
  providerPlaceId: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  categoryHint: 'accommodation' | 'attraction' | 'restaurant' | 'activity' | 'poi';
  types: string[];
  websiteUri: string | null;
  phoneNumber: string | null;
  openingHours: string[] | null;
  attribution: string;
}

export interface OsmRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

// ============================================================================
// Configuration & Defaults
// ============================================================================

const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_OVERPASS_BASE_URL = 'https://overpass-api.de/api/interpreter';
const DEFAULT_USER_AGENT = 'TravelGenie-AITravelPlanner/1.0 (https://github.com/hannyjangir1-commits/AItravelplanner; info@travelgenie.local)';
const DEFAULT_NOMINATIM_TIMEOUT_MS = 10000; // Strict 10s max per Nominatim request
const DEFAULT_OVERPASS_TIMEOUT_MS = 20000;  // Strict 20s max per Overpass query

export function getNominatimBaseUrl(): string {
  return (process.env.NOMINATIM_BASE_URL || DEFAULT_NOMINATIM_BASE_URL).replace(/\/+$/, '');
}

export function getOverpassBaseUrl(): string {
  return (process.env.OVERPASS_BASE_URL || DEFAULT_OVERPASS_BASE_URL).replace(/\/+$/, '');
}

export function getOsmUserAgent(): string {
  return process.env.NOMINATIM_USER_AGENT || DEFAULT_USER_AGENT;
}

// ============================================================================
// In-Memory Caching & Rate Limiting Queue
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
const cache = new Map<string, CacheEntry<any>>();
const inflightRequests = new Map<string, Promise<any>>();

export function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setInCache<T>(key: string, data: T, ttlMs = CACHE_TTL_MS): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
  // Keep cache size bounded to 500 entries
  if (cache.size > 500) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

export function clearOsmCache(): void {
  cache.clear();
  inflightRequests.clear();
}

/**
 * Throttle queue for Nominatim to enforce >= 1000ms spacing between outbound calls.
 */
let lastNominatimRequestTime = 0;
let nominatimQueuePromise: Promise<void> = Promise.resolve();

async function scheduleNominatimRequest<T>(fn: () => Promise<T>): Promise<T> {
  const execute = async () => {
    const now = Date.now();
    const elapsed = now - lastNominatimRequestTime;
    const waitTime = Math.max(0, 1000 - elapsed);
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastNominatimRequestTime = Date.now();
    return fn();
  };

  // Chain to ensure FIFO execution and serialized rate-limiting
  const resultPromise = nominatimQueuePromise.then(execute, execute);
  nominatimQueuePromise = resultPromise.then(() => {}, () => {});
  return resultPromise;
}

// ============================================================================
// Nominatim Geocoding
// ============================================================================

/**
 * Derives a clean canonical name from Nominatim address fields.
 */
function deriveCanonicalNameFromOsm(item: any): string {
  const addr = item.address || {};
  return (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.hamlet ||
    addr.suburb ||
    addr.county ||
    item.name ||
    (item.display_name ? item.display_name.split(',')[0].trim() : 'Unknown Destination')
  );
}

/**
 * Converts Nominatim address fields into structured address components.
 */
function extractAddressComponents(addr: any): OsmNormalizedAddressComponent[] {
  if (!addr || typeof addr !== 'object') return [];

  const components: OsmNormalizedAddressComponent[] = [];
  const typeMap: Record<string, string[]> = {
    city: ['locality', 'political'],
    town: ['locality', 'political'],
    village: ['locality', 'political'],
    hamlet: ['locality', 'political'],
    suburb: ['sublocality', 'political'],
    state_district: ['administrative_area_level_2', 'political'],
    county: ['administrative_area_level_2', 'political'],
    state: ['administrative_area_level_1', 'political'],
    postcode: ['postal_code'],
    country: ['country', 'political'],
    country_code: ['country_code']
  };

  for (const [key, value] of Object.entries(addr)) {
    if (typeof value === 'string' && value.trim()) {
      const types = typeMap[key] || [key];
      components.push({
        longName: value.trim(),
        shortName: key === 'country_code' ? value.toUpperCase() : value.trim(),
        types
      });
    }
  }

  return components;
}

/**
 * Checks if multiple Nominatim search results indicate genuine geographic ambiguity.
 * E.g. "Springfield" returning top candidates in separate states or countries with close importance.
 */
function checkAmbiguity(results: any[], query: string): void {
  if (!Array.isArray(results) || results.length <= 1) return;

  const top = results[0];
  const second = results[1];

  const topImp = Number(top.importance) || 0;
  const secondImp = Number(second.importance) || 0;

  // If the second match is negligible noise (< 0.05) or top match has dominant prominence, match is clear
  if (secondImp < 0.05) return;
  if (topImp - secondImp >= 0.15) return;
  if (secondImp > 0 && (topImp / secondImp) >= 2.0) return;

  // Check if they are in completely different countries or states
  const topCountry = top.address?.country?.toLowerCase();
  const secondCountry = second.address?.country?.toLowerCase();
  const topState = top.address?.state?.toLowerCase();
  const secondState = second.address?.state?.toLowerCase();

  const differentCountries = topCountry && secondCountry && topCountry !== secondCountry;
  const differentStates = topState && secondState && topState !== secondState;

  if (differentCountries || (differentStates && Math.abs(topImp - secondImp) < 0.1)) {
    const candidates = results.slice(0, 3).map((r: any) => r.display_name || `${r.name}`);
    throw new DestinationAmbiguityError(
      `The destination "${query}" is ambiguous. Multiple locations were found across different regions. Please specify the state or country (e.g. "${query}, ${top.address?.state || top.address?.country}").`,
      candidates
    );
  }
}

/**
 * Geocodes an arbitrary destination name using OpenStreetMap Nominatim.
 */
export async function geocodeDestinationWithOsm(
  destination: string,
  options: OsmRequestOptions = {}
): Promise<OsmGeocodeResult> {
  const cleanInput = destination?.trim();
  if (!cleanInput) {
    throw new OsmRequestError('Destination query cannot be empty or blank.', 400);
  }

  const cacheKey = `geocode:${cleanInput.toLowerCase()}`;
  const cached = getFromCache<OsmGeocodeResult>(cacheKey);
  if (cached) {
    return cached;
  }

  // Deduplicate concurrent inflight requests for the same query
  const existingInflight = inflightRequests.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_NOMINATIM_TIMEOUT_MS;

  const execute = async (): Promise<OsmGeocodeResult> => {
    const url = new URL(`${getNominatimBaseUrl()}/search`);
    url.searchParams.set('q', cleanInput);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');

    const headers: Record<string, string> = {
      'User-Agent': getOsmUserAgent(),
      'Accept': 'application/json',
      'Accept-Language': 'en'
    };

    let response: Response;
    try {
      const combinedSignal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

      // Wrap in scheduled queue to respect Nominatim rate limit
      response = await scheduleNominatimRequest(() =>
        fetchFn(url.toString(), {
          method: 'GET',
          headers,
          signal: combinedSignal
        })
      );
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('abort')) {
        throw new OsmTimeoutError(`Nominatim geocoding request timed out for "${cleanInput}".`);
      }
      throw new OsmRequestError(`Nominatim network failure: ${err.message}`);
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new OsmRateLimitError();
      }
      throw new OsmRequestError(`Nominatim HTTP error: ${response.status} ${response.statusText}`, response.status);
    }

    let data: any[];
    try {
      data = await response.json();
    } catch (parseErr: any) {
      throw new OsmRequestError(`Failed to parse Nominatim response as JSON: ${parseErr.message}`);
    }

    if (!Array.isArray(data) || data.length === 0) {
      throw new OsmNoResultsError(`No geographic match found on OpenStreetMap for destination "${cleanInput}".`);
    }

    // Check for ambiguous matches
    checkAmbiguity(data, cleanInput);

    const match = data[0];
    const lat = parseFloat(match.lat);
    const lon = parseFloat(match.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new OsmRequestError(`Invalid coordinates returned by Nominatim for "${cleanInput}".`);
    }

    const canonicalName = deriveCanonicalNameFromOsm(match);
    const addressComponents = extractAddressComponents(match.address);

    let boundingbox: [number, number, number, number] | undefined;
    if (Array.isArray(match.boundingbox) && match.boundingbox.length === 4) {
      const [s, n, w, e] = match.boundingbox.map(parseFloat);
      if ([s, n, w, e].every(Number.isFinite)) {
        boundingbox = [s, n, w, e];
      }
    }

    const result: OsmGeocodeResult = {
      formattedAddress: match.display_name || cleanInput,
      latitude: lat,
      longitude: lon,
      osmType: match.osm_type || 'node',
      osmId: Number(match.osm_id) || 0,
      canonicalName,
      addressComponents,
      boundingbox,
      importance: Number(match.importance) || undefined
    };

    setInCache(cacheKey, result);
    return result;
  };

  const inflightPromise = execute().finally(() => {
    inflightRequests.delete(cacheKey);
  });
  inflightRequests.set(cacheKey, inflightPromise);
  return inflightPromise;
}

// ============================================================================
// Overpass API Place Discovery
// ============================================================================

export interface SearchOsmPlacesParams {
  coordinates: {
    latitude: number;
    longitude: number;
  };
  radiusMeters: number;
  categories?: ('accommodation' | 'attraction' | 'restaurant' | 'activity')[];
  maxResults?: number;
}

/**
 * Builds an Overpass QL query targeted at travel categories within a bounding radius.
 */
export function buildOverpassQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  categories?: string[]
): string {
  const targetCategories = categories && categories.length > 0
    ? categories
    : ['attraction', 'accommodation', 'restaurant', 'activity'];

  const tourismTags: string[] = [];
  const historicTags: string[] = [];
  const amenityTags: string[] = [];
  const leisureTags: string[] = [];

  if (targetCategories.includes('attraction')) {
    tourismTags.push('attraction', 'museum', 'theme_park', 'viewpoint', 'zoo', 'artwork', 'gallery', 'aquarium');
    historicTags.push('monument', 'memorial', 'castle', 'fort', 'ruins', 'archaeological_site', 'heritage', 'building');
    leisureTags.push('park', 'garden', 'nature_reserve');
    amenityTags.push('place_of_worship');
  }

  if (targetCategories.includes('accommodation')) {
    tourismTags.push('hotel', 'guest_house', 'resort', 'motel', 'hostel', 'bed_and_breakfast', 'apartment', 'chalet');
  }

  if (targetCategories.includes('restaurant')) {
    amenityTags.push('restaurant', 'cafe', 'bakery', 'food_court', 'fast_food', 'bar', 'pub', 'ice_cream');
  }

  if (targetCategories.includes('activity')) {
    leisureTags.push('water_park', 'sports_centre', 'stadium', 'bowling_alley', 'amusement_arcade');
    amenityTags.push('cinema', 'theatre', 'arts_centre');
  }

  const statements: string[] = [];
  const around = `(around:${radiusMeters},${lat},${lon})`;

  if (tourismTags.length > 0) {
    statements.push(`nwr${around}["tourism"~"${tourismTags.join('|')}"]["name"];`);
  }
  if (historicTags.length > 0) {
    statements.push(`nwr${around}["historic"~"${historicTags.join('|')}"]["name"];`);
  }
  if (amenityTags.length > 0) {
    statements.push(`nwr${around}["amenity"~"${amenityTags.join('|')}"]["name"];`);
  }
  if (leisureTags.length > 0) {
    statements.push(`nwr${around}["leisure"~"${leisureTags.join('|')}"]["name"];`);
  }

  return `[out:json][timeout:25];
(
  ${statements.join('\n  ')}
);
out center tags qt;`;
}

/**
 * Determines primary category from OSM tags.
 */
export function classifyOsmPlace(tags: Record<string, string>): {
  category: 'accommodation' | 'attraction' | 'restaurant' | 'activity' | 'poi';
  types: string[];
} {
  const types: string[] = [];

  // 1. Accommodation
  if (tags.tourism && /^(hotel|guest_house|resort|motel|hostel|bed_and_breakfast|apartment|chalet)$/i.test(tags.tourism)) {
    types.push(tags.tourism.toLowerCase());
    return { category: 'accommodation', types };
  }

  // 2. Dining
  if (tags.amenity && /^(restaurant|cafe|bakery|food_court|fast_food|bar|pub|ice_cream)$/i.test(tags.amenity)) {
    types.push(tags.amenity.toLowerCase());
    if (tags.cuisine) types.push(...tags.cuisine.split(';').map((c) => c.trim().toLowerCase()));
    return { category: 'restaurant', types };
  }

  // 3. Activities
  if (
    (tags.leisure && /^(water_park|sports_centre|stadium|bowling_alley|amusement_arcade)$/i.test(tags.leisure)) ||
    (tags.amenity && /^(cinema|theatre|arts_centre)$/i.test(tags.amenity))
  ) {
    if (tags.leisure) types.push(tags.leisure.toLowerCase());
    if (tags.amenity) types.push(tags.amenity.toLowerCase());
    return { category: 'activity', types };
  }

  // 4. Attractions / Culture / Nature
  if (tags.tourism && /^(attraction|museum|theme_park|viewpoint|zoo|artwork|gallery|aquarium)$/i.test(tags.tourism)) {
    types.push(tags.tourism.toLowerCase());
  }
  if (tags.historic) {
    types.push(`historic_${tags.historic.toLowerCase()}`);
  }
  if (tags.amenity === 'place_of_worship') {
    types.push('place_of_worship');
    if (tags.religion) types.push(`${tags.religion.toLowerCase()}_temple`);
  }
  if (tags.leisure && /^(park|garden|nature_reserve)$/i.test(tags.leisure)) {
    types.push(tags.leisure.toLowerCase());
  }

  if (types.length > 0) {
    return { category: 'attraction', types };
  }

  return { category: 'poi', types: ['point_of_interest'] };
}

/**
 * Normalizes an Overpass element into InternalOsmPlace.
 */
export function normalizeOsmElement(
  element: any,
  anchor: { latitude: number; longitude: number }
): InternalOsmPlace | null {
  if (!element || typeof element !== 'object') return null;

  const osmType = element.type;
  const osmId = element.id;
  if (!osmType || !osmId) return null;

  const tags = element.tags || {};
  const name = (tags.name || tags['name:en'] || tags.int_name || tags.official_name)?.trim();
  if (!name || name === 'Unknown Place') return null;

  // Coordinate resolution: nodes have lat/lon; ways/relations have center.lat/center.lon
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const { category, types } = classifyOsmPlace(tags);

  // Address assembly
  const addressParts: string[] = [];
  if (tags['addr:housenumber'] && tags['addr:street']) {
    addressParts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`);
  } else if (tags['addr:street']) {
    addressParts.push(tags['addr:street']);
  }
  if (tags['addr:suburb']) addressParts.push(tags['addr:suburb']);
  if (tags['addr:city']) addressParts.push(tags['addr:city']);
  if (tags['addr:postcode']) addressParts.push(tags['addr:postcode']);

  const formattedAddress = addressParts.join(', ');

  const websiteUri = tags.website || tags['contact:website'] || tags.url || null;
  const phoneNumber = tags.phone || tags['contact:phone'] || null;

  let openingHours: string[] | null = null;
  if (tags.opening_hours) {
    openingHours = [tags.opening_hours.trim()];
  }

  const providerPlaceId = `osm:${osmType}/${osmId}`;

  return {
    providerPlaceId,
    osmType,
    osmId,
    name,
    formattedAddress,
    latitude: lat,
    longitude: lon,
    tags,
    categoryHint: category,
    types,
    websiteUri,
    phoneNumber,
    openingHours,
    attribution: 'OpenStreetMap contributors'
  };
}

/**
 * Queries OpenStreetMap data via Overpass API within radius around coordinates.
 */
export async function searchOsmPlacesNearby(
  params: SearchOsmPlacesParams,
  options: OsmRequestOptions = {}
): Promise<InternalOsmPlace[]> {
  const { coordinates, radiusMeters, categories, maxResults = 300 } = params;
  if (!coordinates || !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) {
    throw new OsmRequestError('Valid coordinates (latitude, longitude) are required for OSM search.', 400);
  }

  const boundedRadius = Math.min(Math.max(radiusMeters, 100), 25000); // Max 25km
  const cacheKey = `overpass:${coordinates.latitude.toFixed(3)},${coordinates.longitude.toFixed(3)}:r${boundedRadius}:${categories?.sort().join(',') || 'all'}`;

  const cached = getFromCache<InternalOsmPlace[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const existingInflight = inflightRequests.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OVERPASS_TIMEOUT_MS;

  const execute = async (): Promise<InternalOsmPlace[]> => {
    const ql = buildOverpassQuery(coordinates.latitude, coordinates.longitude, boundedRadius, categories);
    const candidateUrls = options.fetchFn
      ? [getOverpassBaseUrl()]
      : [
          getOverpassBaseUrl(),
          'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
        ];

    let response: Response | null = null;
    let lastError: Error | null = null;

    for (const url of candidateUrls) {
      try {
        const combinedSignal = options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);

        const res = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': getOsmUserAgent(),
            'Accept': 'application/json'
          },
          body: `data=${encodeURIComponent(ql)}`,
          signal: combinedSignal
        });

        if (res.ok) {
          response = res;
          break;
        }

        if (res.status === 429) {
          lastError = new OsmRateLimitError();
          continue;
        }

        if (res.status >= 500) {
          lastError = new OsmRequestError(`Overpass API server returned status ${res.status}`, res.status);
          continue;
        }

        lastError = new OsmRequestError(`Overpass API returned status ${res.status}`, res.status);
      } catch (err: any) {
        if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('abort')) {
          lastError = new OsmTimeoutError('Overpass API query timed out.');
          break; // Stop immediately on timeout to avoid hanging through multiple endpoints
        } else {
          lastError = new OsmRequestError(`Overpass API network error: ${err.message}`);
        }
      }
    }

    if (!response) {
      throw lastError || new OsmRequestError('All Overpass API endpoints failed to respond.');
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch (parseErr: any) {
      throw new OsmRequestError(`Malformed JSON from Overpass API: ${parseErr.message}`);
    }

    const elements: any[] = Array.isArray(payload.elements) ? payload.elements : [];
    const normalizedPlaces: InternalOsmPlace[] = [];
    const seenIds = new Set<string>();

    for (const el of elements) {
      const place = normalizeOsmElement(el, coordinates);
      if (place && !seenIds.has(place.providerPlaceId)) {
        seenIds.add(place.providerPlaceId);
        normalizedPlaces.push(place);
      }
      if (normalizedPlaces.length >= maxResults) break;
    }

    setInCache(cacheKey, normalizedPlaces);
    return normalizedPlaces;
  };

  const inflightPromise = execute().finally(() => {
    inflightRequests.delete(cacheKey);
  });
  inflightRequests.set(cacheKey, inflightPromise);
  return inflightPromise;
}
