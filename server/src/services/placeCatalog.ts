/**
 * Deterministic Place Catalog Builder for TravelGenie.
 *
 * Constructs a verified place catalog backed strictly by Google Places API (New)
 * data, using radial concentric search tiers (5km -> 15km -> 25km) and
 * strict entity deduplication.
 *
 * CORE INTEGRITY RULES:
 * 1. Every VerifiedPlace originates from a Google Places provider response.
 * 2. Every VerifiedPlace has a valid providerPlaceId, name, and coordinates.
 * 3. Zero fake places are generated (no template interpolation or fake village entities).
 * 4. Missing fields remain strictly null; no guessed values.
 * 5. Prices are NOT estimated in this phase (priceStatus is PRICE_LEVEL_ONLY or
 *    PRICE_UNAVAILABLE, estimatedPriceInrRange is null).
 * 6. Rural destinations return honest counts (e.g. 0 accommodations if none exist).
 */

import {
  VerifiedPlace,
  LocalityRelation,
  PriceStatus,
  PlacePrimaryCategory
} from '../types.js';
import { calculateDistanceMeters } from './geo.js';
import {
  InternalGooglePlace,
  GoogleRequestOptions,
  searchPlacesNearby,
  searchPlacesByText
} from './googlePlaces.js';
import { ResolvedDestination } from './destinationResolver.js';

// ============================================================================
// Configurable Search Constants & Tiers
// ============================================================================

export const MIN_ACCOMMODATION_RESULTS = 3;
export const MIN_ATTRACTION_RESULTS = 4;
export const MIN_RESTAURANT_RESULTS = 3;
export const MIN_ACTIVITY_RESULTS = 2;

export const RADIUS_TIER_1_METERS = 5000;   // 5 km: Exact destination settlement
export const RADIUS_TIER_2_METERS = 15000;  // 15 km: Nearby outskirts
export const RADIUS_TIER_3_METERS = 25000;  // 25 km: Nearest practical town / commercial hub
export const MAX_SEARCH_RADIUS_METERS = 25000; // 25 km maximum allowable distance

export const DEFAULT_SEARCH_RADII = [
  RADIUS_TIER_1_METERS,
  RADIUS_TIER_2_METERS,
  RADIUS_TIER_3_METERS
];

// ============================================================================
// Google Place Types by Category (Places API New Table A)
// ============================================================================

export const ACCOMMODATION_PLACE_TYPES = [
  'hotel',
  'lodging',
  'resort_hotel',
  'guest_house',
  'bed_and_breakfast',
  'motel'
];

export const ATTRACTION_PLACE_TYPES = [
  'tourist_attraction',
  'museum',
  'historical_landmark',
  'park',
  'place_of_worship',
  'hindu_temple',
  'national_park',
  'art_gallery'
];

export const RESTAURANT_PLACE_TYPES = [
  'restaurant',
  'cafe',
  'bakery',
  'meal_takeaway',
  'fast_food_restaurant',
  'bar'
];

export const ACTIVITY_PLACE_TYPES = [
  'amusement_park',
  'campground',
  'sports_complex',
  'bowling_alley',
  'movie_theater',
  'community_center'
];

// ============================================================================
// Types & Options
// ============================================================================

export interface CatalogBuilderOptions extends GoogleRequestOptions {
  customRadii?: number[];
  minAccommodation?: number;
  minAttractions?: number;
  minRestaurants?: number;
  minActivities?: number;
  verificationTimestamp?: string;
}

export interface VerifiedPlaceCatalog {
  destination: ResolvedDestination;
  places: VerifiedPlace[];
  byCategory: {
    accommodation: VerifiedPlace[];
    attraction: VerifiedPlace[];
    restaurant: VerifiedPlace[];
    activity: VerifiedPlace[];
    poi: VerifiedPlace[];
  };
  metadata: {
    generatedAt: string;
    searchRadiiMeters: number[];
    totalVerifiedPlaces: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Assigns locality relation based on geodesic distance from destination anchor.
 * 0–5 km: 'exact_destination'
 * >5–15 km: 'nearby'
 * >15–25 km: 'nearest_town'
 */
export function determineLocalityRelation(distanceMeters: number): LocalityRelation {
  if (distanceMeters <= RADIUS_TIER_1_METERS) {
    return 'exact_destination';
  }
  if (distanceMeters <= RADIUS_TIER_2_METERS) {
    return 'nearby';
  }
  return 'nearest_town';
}

/**
 * Converts a raw InternalGooglePlace into a normalized VerifiedPlace.
 * Returns null if the place violates data integrity constraints
 * (missing Place ID, missing name, non-finite coordinates, or out of 25km radius).
 */
export function toVerifiedPlace(
  place: InternalGooglePlace,
  destinationAnchor: { latitude: number; longitude: number },
  primaryCategory: PlacePrimaryCategory,
  internalIdIndex: number,
  verificationTimestamp: string
): VerifiedPlace | null {
  if (!place || typeof place !== 'object') {
    return null;
  }

  // Integrity Check 1: Provider Place ID must exist and be non-empty
  const placeId = place.providerPlaceId?.trim();
  if (!placeId) {
    return null;
  }

  // Integrity Check 2: Place name must exist, be non-empty, and not be default placeholder
  const name = place.name?.trim();
  if (!name || name === 'Unknown Place') {
    return null;
  }

  // Integrity Check 3: Coordinates must be valid finite numbers
  if (
    !Number.isFinite(place.latitude) ||
    !Number.isFinite(place.longitude) ||
    place.latitude < -90 ||
    place.latitude > 90 ||
    place.longitude < -180 ||
    place.longitude > 180
  ) {
    return null;
  }

  // Geodesic distance calculation from destination anchor
  const distanceMeters = calculateDistanceMeters(
    destinationAnchor.latitude,
    destinationAnchor.longitude,
    place.latitude,
    place.longitude
  );

  // Integrity Check 4: Enforce maximum search radius cap (25 km)
  if (distanceMeters > MAX_SEARCH_RADIUS_METERS) {
    return null;
  }

  const localityRelation = determineLocalityRelation(distanceMeters);

  // Price Status: In Phase 2A, do NOT calculate prices.
  // Use PRICE_LEVEL_ONLY if Google provided priceLevel, else PRICE_UNAVAILABLE.
  const priceStatus: PriceStatus = place.priceLevel && place.priceLevel.trim()
    ? 'PRICE_LEVEL_ONLY'
    : 'PRICE_UNAVAILABLE';

  // Format internal ID deterministically: VP_01, VP_02, ...
  const internalId = `VP_${String(internalIdIndex).padStart(2, '0')}`;

  return {
    internalId,
    provider: 'google_places',
    providerPlaceId: placeId,
    name,
    primaryCategory,
    types: Array.isArray(place.types) ? [...place.types] : [],
    formattedAddress: place.formattedAddress?.trim() || '',
    location: {
      latitude: place.latitude,
      longitude: place.longitude
    },
    distanceMeters,
    localityRelation,
    rating: typeof place.rating === 'number' && Number.isFinite(place.rating) ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' && Number.isInteger(place.userRatingCount)
      ? place.userRatingCount
      : null,
    googleMapsUri: place.googleMapsUri?.trim() || null,
    websiteUri: place.websiteUri?.trim() || null,
    phoneNumber: place.phoneNumber?.trim() || null,
    openingHours: Array.isArray(place.openingHours) ? [...place.openingHours] : null,
    priceLevel: place.priceLevel?.trim() || null,
    priceStatus,
    estimatedPriceInrRange: null, // Strictly null per Phase 2A requirement
    verificationTimestamp
  };
}

/**
 * Deterministic comparator for ranking verified places within a category:
 * 1. Locality relation priority (exact_destination < nearby < nearest_town)
 * 2. Closer distanceMeters within the same locality tier
 * 3. Rating descending (places with rating before places without)
 * 4. User review count descending
 * 5. Name alphabetical, then providerPlaceId as final deterministic tie-breaker
 */
export function compareVerifiedPlaces(a: VerifiedPlace, b: VerifiedPlace): number {
  const localityWeight: Record<LocalityRelation, number> = {
    exact_destination: 0,
    nearby: 1,
    nearest_town: 2
  };

  const localityDiff = localityWeight[a.localityRelation] - localityWeight[b.localityRelation];
  if (localityDiff !== 0) {
    return localityDiff;
  }

  if (a.distanceMeters !== b.distanceMeters) {
    return a.distanceMeters - b.distanceMeters;
  }

  const aRating = a.rating ?? -1;
  const bRating = b.rating ?? -1;
  if (aRating !== bRating) {
    return bRating - aRating;
  }

  const aCount = a.userRatingCount ?? -1;
  const bCount = b.userRatingCount ?? -1;
  if (aCount !== bCount) {
    return bCount - aCount;
  }

  const nameDiff = a.name.localeCompare(b.name);
  if (nameDiff !== 0) {
    return nameDiff;
  }

  return a.providerPlaceId.localeCompare(b.providerPlaceId);
}

// ============================================================================
// Core Category Search Functions
// ============================================================================

/**
 * Executes tiered concentric search for a specific category until the minimum
 * target count is met or the maximum search radius (25 km) is reached.
 */
async function searchCategoryWithExpansion(
  destinationAnchor: { latitude: number; longitude: number },
  searchFn: (radiusMeters: number) => Promise<InternalGooglePlace[]>,
  minTargetCount: number,
  radii: number[]
): Promise<InternalGooglePlace[]> {
  const seenPlaceIds = new Set<string>();
  const collectedPlaces: InternalGooglePlace[] = [];

  for (const radius of radii) {
    // If we already have enough verified places from closer tiers, stop expanding
    if (collectedPlaces.length >= minTargetCount) {
      break;
    }

    try {
      const placesAtRadius = await searchFn(radius);
      for (const place of placesAtRadius) {
        if (place?.providerPlaceId && !seenPlaceIds.has(place.providerPlaceId)) {
          seenPlaceIds.add(place.providerPlaceId);
          collectedPlaces.push(place);
        }
      }
    } catch (err) {
      // In case of an individual tier network blip, continue with existing collected places
      console.warn(`[PlaceCatalog] Search tier at ${radius}m encountered error:`, err instanceof Error ? err.message : err);
    }
  }

  return collectedPlaces;
}

// ============================================================================
// Main Catalog Builder Service
// ============================================================================

/**
 * Builds a deterministic verified place catalog for a resolved destination.
 *
 * @param destination ResolvedDestination from destinationResolver
 * @param options Optional builder options (custom radii, minimum targets, timeout, mock fetch)
 * @returns Fully populated, deduplicated, and ranked VerifiedPlaceCatalog
 */
export async function buildVerifiedPlaceCatalog(
  destination: ResolvedDestination,
  options: CatalogBuilderOptions = {}
): Promise<VerifiedPlaceCatalog> {
  if (!destination || typeof destination !== 'object') {
    throw new Error('Valid ResolvedDestination is required to build place catalog.');
  }

  const anchor = {
    latitude: destination.latitude,
    longitude: destination.longitude
  };

  const radii = options.customRadii && options.customRadii.length > 0
    ? options.customRadii.filter((r) => r > 0 && r <= MAX_SEARCH_RADIUS_METERS)
    : DEFAULT_SEARCH_RADII;

  const minAccom = options.minAccommodation ?? MIN_ACCOMMODATION_RESULTS;
  const minAttr = options.minAttractions ?? MIN_ATTRACTION_RESULTS;
  const minRest = options.minRestaurants ?? MIN_RESTAURANT_RESULTS;
  const minAct = options.minActivities ?? MIN_ACTIVITY_RESULTS;

  const verificationTimestamp = options.verificationTimestamp || new Date().toISOString();

  // Forward GoogleRequestOptions (signal, timeoutMs, fetchFn) to provider calls
  const requestOpts: GoogleRequestOptions = {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fetchFn: options.fetchFn
  };

  // --------------------------------------------------------------------------
  // 1. Accommodation Search
  // --------------------------------------------------------------------------
  const rawAccommodations = await searchCategoryWithExpansion(
    anchor,
    (radiusMeters) =>
      searchPlacesNearby(
        {
          coordinates: anchor,
          radiusMeters,
          includedTypes: ACCOMMODATION_PLACE_TYPES
        },
        requestOpts
      ),
    minAccom,
    radii
  );

  // --------------------------------------------------------------------------
  // 2. Attractions Search
  // --------------------------------------------------------------------------
  const rawAttractions = await searchCategoryWithExpansion(
    anchor,
    (radiusMeters) =>
      searchPlacesNearby(
        {
          coordinates: anchor,
          radiusMeters,
          includedTypes: ATTRACTION_PLACE_TYPES
        },
        requestOpts
      ),
    minAttr,
    radii
  );

  // --------------------------------------------------------------------------
  // 3. Restaurants / Dining Search
  // --------------------------------------------------------------------------
  const rawRestaurants = await searchCategoryWithExpansion(
    anchor,
    (radiusMeters) =>
      searchPlacesNearby(
        {
          coordinates: anchor,
          radiusMeters,
          includedTypes: RESTAURANT_PLACE_TYPES
        },
        requestOpts
      ),
    minRest,
    radii
  );

  // --------------------------------------------------------------------------
  // 4. Activities Search (Nearby activity POIs + location-biased text search)
  // --------------------------------------------------------------------------
  const rawActivities = await searchCategoryWithExpansion(
    anchor,
    async (radiusMeters) => {
      // First try nearby activity types
      const nearbyActs = await searchPlacesNearby(
        {
          coordinates: anchor,
          radiusMeters,
          includedTypes: ACTIVITY_PLACE_TYPES
        },
        requestOpts
      );

      // If nearby returns few, supplement with location-biased text search
      if (nearbyActs.length < minAct) {
        try {
          const textActs = await searchPlacesByText(
            {
              textQuery: `things to do near ${destination.canonicalName}`,
              center: anchor,
              radiusMeters,
              maxResultCount: 5
            },
            requestOpts
          );
          const combined = [...nearbyActs];
          const existingIds = new Set(nearbyActs.map((p) => p.providerPlaceId));
          for (const act of textActs) {
            if (act.providerPlaceId && !existingIds.has(act.providerPlaceId)) {
              existingIds.add(act.providerPlaceId);
              combined.push(act);
            }
          }
          return combined;
        } catch {
          return nearbyActs;
        }
      }
      return nearbyActs;
    },
    minAct,
    radii
  );

  // --------------------------------------------------------------------------
  // 5. Global Deduplication & Category Mapping
  // --------------------------------------------------------------------------
  const globalSeenPlaceIds = new Set<string>();
  const byCategory: VerifiedPlaceCatalog['byCategory'] = {
    accommodation: [],
    attraction: [],
    restaurant: [],
    activity: [],
    poi: []
  };

  let globalIdCounter = 1;

  // Process a raw list for a specific primary category
  const processCategoryList = (
    rawList: InternalGooglePlace[],
    category: PlacePrimaryCategory
  ) => {
    for (const rawPlace of rawList) {
      if (!rawPlace?.providerPlaceId) continue;
      if (globalSeenPlaceIds.has(rawPlace.providerPlaceId)) continue;

      const verified = toVerifiedPlace(
        rawPlace,
        anchor,
        category,
        globalIdCounter,
        verificationTimestamp
      );

      if (verified) {
        globalSeenPlaceIds.add(verified.providerPlaceId);
        globalIdCounter++;
        byCategory[category].push(verified);
      }
    }
  };

  // Process categories in prioritized order
  processCategoryList(rawAccommodations, 'accommodation');
  processCategoryList(rawAttractions, 'attraction');
  processCategoryList(rawRestaurants, 'restaurant');
  processCategoryList(rawActivities, 'activity');

  // Any remaining attractions with specific landmark types can populate poi
  for (const attr of byCategory.attraction) {
    if (
      attr.types.includes('historical_landmark') ||
      attr.types.includes('natural_feature') ||
      attr.types.includes('point_of_interest')
    ) {
      byCategory.poi.push(attr);
    }
  }

  // --------------------------------------------------------------------------
  // 6. Deterministic Sorting within Categories
  // --------------------------------------------------------------------------
  byCategory.accommodation.sort(compareVerifiedPlaces);
  byCategory.attraction.sort(compareVerifiedPlaces);
  byCategory.restaurant.sort(compareVerifiedPlaces);
  byCategory.activity.sort(compareVerifiedPlaces);
  byCategory.poi.sort(compareVerifiedPlaces);

  // --------------------------------------------------------------------------
  // 7. Master Place List with Clean Sequential IDs
  // --------------------------------------------------------------------------
  // Collect all unique verified places into a master array
  const allPlaces: VerifiedPlace[] = [
    ...byCategory.accommodation,
    ...byCategory.attraction,
    ...byCategory.restaurant,
    ...byCategory.activity
  ];

  // Re-index internal IDs sequentially across the master list for perfect consistency
  allPlaces.forEach((place, idx) => {
    place.internalId = `VP_${String(idx + 1).padStart(2, '0')}`;
  });

  return {
    destination,
    places: allPlaces,
    byCategory,
    metadata: {
      generatedAt: verificationTimestamp,
      searchRadiiMeters: radii,
      totalVerifiedPlaces: allPlaces.length
    }
  };
}

/**
 * Formats a VerifiedPlaceCatalog into a compact, token-efficient, and unambiguous
 * text block suitable for Gemini system and user prompt injection.
 */
export function formatCatalogForPrompt(catalog: VerifiedPlaceCatalog): string {
  const lines: string[] = [
    `Destination Anchor: ${catalog.destination.canonicalName} (${catalog.destination.latitude.toFixed(4)}, ${catalog.destination.longitude.toFixed(4)})`,
    `Address: ${catalog.destination.formattedAddress}`,
    ''
  ];

  const formatList = (title: string, list: VerifiedPlace[]) => {
    lines.push(`[${title} (${list.length} verified found)]:`);
    if (list.length === 0) {
      lines.push('  (None found within 25 km of destination)');
    } else {
      for (const p of list) {
        const parts: string[] = [
          `ID: ${p.internalId}`,
          `Name: "${p.name}"`,
          `Category: ${p.primaryCategory}`,
          `Address: ${p.formattedAddress || 'N/A'}`,
          `Locality: ${p.localityRelation} (~${(p.distanceMeters / 1000).toFixed(1)} km from anchor)`
        ];
        if (p.rating !== null) {
          parts.push(`Rating: ${p.rating}${p.userRatingCount ? ` (${p.userRatingCount} reviews)` : ''}`);
        }
        if (p.priceLevel) {
          parts.push(`Price Tier: ${p.priceLevel}`);
        }
        lines.push(`  - ${parts.join(' | ')}`);
      }
    }
    lines.push('');
  };

  formatList('ACCOMMODATION', catalog.byCategory.accommodation);
  formatList('ATTRACTIONS & POIs', catalog.byCategory.attraction);
  formatList('RESTAURANTS & DINING', catalog.byCategory.restaurant);
  formatList('ACTIVITIES & EXPERIENCES', catalog.byCategory.activity);

  return lines.join('\n').trim();
}

