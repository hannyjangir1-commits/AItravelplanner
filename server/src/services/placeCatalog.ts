/**
 * Deterministic Place Catalog Builder for TravelGenie.
 *
 * Constructs a verified place catalog backed strictly by OpenStreetMap (Overpass API)
 * data, using geodesic distance calculations, radial concentric locality tiers
 * (exact_destination <= 5km -> nearby <= 15km -> nearest_town <= 25km),
 * and strict entity deduplication.
 *
 * CORE INTEGRITY RULES:
 * 1. Every VerifiedPlace originates from an authentic OpenStreetMap provider response.
 * 2. Every VerifiedPlace has a valid providerPlaceId (osm:type/id), name, and coordinates.
 * 3. Zero fake places are generated (no template interpolation or hallucinated entities).
 * 4. Missing fields remain strictly null; no guessed values.
 * 5. Prices and ratings are NEVER invented (priceStatus is PRICE_UNAVAILABLE, rating is null).
 * 6. Rural destinations return honest counts (e.g. 0 accommodations if none exist).
 * 7. Source attribution "OpenStreetMap contributors" is preserved on all entities.
 */

import {
  VerifiedPlace,
  LocalityRelation,
  PriceStatus,
  PlacePrimaryCategory
} from '../types.js';
import { calculateDistanceMeters } from './geo.js';
import {
  InternalOsmPlace,
  OsmRequestOptions,
  searchOsmPlacesNearby
} from './osmProvider.js';
import { ResolvedDestination } from './destinationResolver.js';

// ============================================================================
// Configurable Search Constants & Tiers
// ============================================================================

export const RADIUS_TIER_1_METERS = 5000;   // 5 km: Exact destination settlement
export const RADIUS_TIER_2_METERS = 15000;  // 15 km: Nearby outskirts
export const RADIUS_TIER_3_METERS = 25000;  // 25 km: Nearest practical town / commercial hub
export const MAX_SEARCH_RADIUS_METERS = 25000; // 25 km maximum allowable distance

export const DEFAULT_SEARCH_RADII = [
  RADIUS_TIER_1_METERS,
  RADIUS_TIER_2_METERS,
  RADIUS_TIER_3_METERS
];

// OpenStreetMap tags reference constants
export const OSM_ACCOMMODATION_TAGS = [
  'hotel',
  'guest_house',
  'resort',
  'motel',
  'hostel',
  'bed_and_breakfast',
  'apartment'
];

export const OSM_ATTRACTION_TAGS = [
  'attraction',
  'museum',
  'theme_park',
  'viewpoint',
  'monument',
  'memorial',
  'castle',
  'fort',
  'park',
  'garden',
  'place_of_worship'
];

export const OSM_RESTAURANT_TAGS = [
  'restaurant',
  'cafe',
  'bakery',
  'fast_food',
  'food_court',
  'bar',
  'pub'
];

export const OSM_ACTIVITY_TAGS = [
  'water_park',
  'sports_centre',
  'cinema',
  'theatre',
  'bowling_alley',
  'arts_centre'
];

// Backward-compatible tag list aliases for legacy tests and providers
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
  'hindu_temple',
  'church',
  'mosque',
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
  'movie_theater'
];

// ============================================================================
// Types & Options
// ============================================================================

export interface CatalogBuilderOptions extends OsmRequestOptions {
  customRadii?: number[];
  maxRadiusMeters?: number;
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
    dataSource: string;
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
 * Converts a raw InternalOsmPlace into a normalized VerifiedPlace.
 * Returns null if the place violates data integrity constraints
 * (missing Place ID, missing name, non-finite coordinates, or out of 25km radius).
 */
export function toVerifiedPlace(
  place: InternalOsmPlace,
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
  const isGoogle = (place as any).provider === 'google_places' || !!(place as any).googleMapsUri || (place as any).rating !== undefined;
  const provider = (place as any).provider || (isGoogle ? 'google_places' : 'openstreetmap');
  const rating = typeof (place as any).rating === 'number' ? (place as any).rating : null;
  const userRatingCount = typeof (place as any).userRatingCount === 'number' ? (place as any).userRatingCount : null;
  const googleMapsUri = (place as any).googleMapsUri?.trim() || null;
  const priceLevel = (place as any).priceLevel || null;
  const priceStatus: PriceStatus = (place as any).priceStatus || (priceLevel ? 'PRICE_LEVEL_ONLY' : 'PRICE_UNAVAILABLE');

  // Format internal ID deterministically: VP_01, VP_02, ...
  const internalId = `VP_${String(internalIdIndex).padStart(2, '0')}`;

  return {
    internalId,
    provider,
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
    rating,
    userRatingCount,
    googleMapsUri,
    websiteUri: place.websiteUri?.trim() || null,
    phoneNumber: place.phoneNumber?.trim() || null,
    openingHours: Array.isArray(place.openingHours) ? [...place.openingHours] : null,
    priceLevel,
    priceStatus,
    estimatedPriceInrRange: null,
    verificationTimestamp,
    attribution: place.attribution || (isGoogle ? 'Google' : 'OpenStreetMap contributors')
  };
}

/**
 * Deterministic comparator for ranking verified places within a category:
 * 1. Locality relation priority (exact_destination < nearby < nearest_town)
 * 2. Closer distanceMeters within the same locality tier
 * 3. Name alphabetical, then providerPlaceId as final deterministic tie-breaker
 */
export function compareVerifiedPlaces(a: VerifiedPlace, b: VerifiedPlace): number {
  const localityWeight: Record<LocalityRelation, number> = {
    exact_destination: 0,
    nearby: 1,
    nearest_town: 2
  };

  const weightA = localityWeight[a.localityRelation] ?? 99;
  const weightB = localityWeight[b.localityRelation] ?? 99;
  if (weightA !== weightB) {
    return weightA - weightB;
  }

  if (a.distanceMeters !== b.distanceMeters) {
    return a.distanceMeters - b.distanceMeters;
  }

  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) {
    return nameCmp;
  }

  return a.providerPlaceId.localeCompare(b.providerPlaceId);
}

// ============================================================================
// Main Catalog Builder Service
// ============================================================================

/**
 * Builds a deterministic verified place catalog for a resolved destination using OpenStreetMap data.
 *
 * @param destination ResolvedDestination from destinationResolver
 * @param options Optional builder options (custom radii, timeout, mock fetch)
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

  const maxRadius = Math.min(options.maxRadiusMeters || MAX_SEARCH_RADIUS_METERS, MAX_SEARCH_RADIUS_METERS);
  const radii = options.customRadii || (options.maxRadiusMeters ? [options.maxRadiusMeters] : DEFAULT_SEARCH_RADII);
  const verificationTimestamp = options.verificationTimestamp || new Date().toISOString();

  // Query OpenStreetMap data via Overpass API (concentric expansion from 5km to 25km)
  let rawPlaces: InternalOsmPlace[] = [];
  for (const r of radii) {
    const boundedRadius = Math.min(r, maxRadius);
    try {
      const placesAtTier = await searchOsmPlacesNearby(
        {
          coordinates: anchor,
          radiusMeters: boundedRadius,
          maxResults: 300
        },
        options
      );

      if (placesAtTier.length > 0) {
        rawPlaces = placesAtTier;
      }

      // Check category coverage at current tier
      const accomCount = placesAtTier.filter(p => p.categoryHint === 'accommodation').length;
      const attrCount = placesAtTier.filter(p => p.categoryHint === 'attraction').length;
      const minAccom = options.minAccommodation ?? 1;
      const minAttr = options.minAttractions ?? 2;

      // Stop expanding if sufficient attractions and accommodations exist,
      // or if we have a robust catalog with representation across both categories,
      // or if we reached the maximum search radius.
      const hasCoverage = (attrCount >= minAttr && accomCount >= minAccom) ||
                          (placesAtTier.length >= 15 && attrCount >= 1 && accomCount >= 1);

      if (hasCoverage || boundedRadius >= maxRadius) {
        break;
      }
    } catch (err: any) {
      console.warn(`[PlaceCatalog Diagnostics] OpenStreetMap search at ${boundedRadius}m failed for "${destination.canonicalName}": ${err.message}`);
      if (rawPlaces.length > 0) break;
    }
  }

  const byCategory: VerifiedPlaceCatalog['byCategory'] = {
    accommodation: [],
    attraction: [],
    restaurant: [],
    activity: [],
    poi: []
  };

  const seenPlaceIds = new Set<string>();
  const seenPlaceSignatures = new Set<string>();
  let tempIndex = 1;

  for (const raw of rawPlaces) {
    if (!raw.providerPlaceId || seenPlaceIds.has(raw.providerPlaceId)) {
      continue;
    }

    // Name + distance deduplication (prevents duplicate nodes/ways for same venue)
    const normName = raw.name.toLowerCase().trim();
    const signature = `${normName}_${Math.round(raw.latitude * 1000)}_${Math.round(raw.longitude * 1000)}`;
    if (seenPlaceSignatures.has(signature)) {
      continue;
    }

    const category: PlacePrimaryCategory = raw.categoryHint || 'attraction';
    const verified = toVerifiedPlace(
      raw,
      anchor,
      category,
      tempIndex++,
      verificationTimestamp
    );

    if (verified) {
      seenPlaceIds.add(raw.providerPlaceId);
      seenPlaceSignatures.add(signature);
      byCategory[category].push(verified);
    }
  }

  // Sort each category deterministically
  for (const category of Object.keys(byCategory) as PlacePrimaryCategory[]) {
    byCategory[category].sort(compareVerifiedPlaces);
  }

  // Combine into master list in strict category order
  const allPlaces: VerifiedPlace[] = [
    ...byCategory.accommodation,
    ...byCategory.attraction,
    ...byCategory.restaurant,
    ...byCategory.activity,
    ...byCategory.poi
  ];

  // Re-index internal IDs sequentially across the master list
  allPlaces.forEach((place, idx) => {
    place.internalId = `VP_${String(idx + 1).padStart(2, '0')}`;
  });

  console.log(
    `[PlaceCatalog Diagnostics] OSM Catalog completed for "${destination.canonicalName}" (${anchor.latitude.toFixed(4)}, ${anchor.longitude.toFixed(4)}): ` +
    `accommodations=${byCategory.accommodation.length}, attractions=${byCategory.attraction.length}, ` +
    `restaurants=${byCategory.restaurant.length}, activities=${byCategory.activity.length}, totalVerifiedPlaces=${allPlaces.length}`
  );

  return {
    destination,
    places: allPlaces,
    byCategory,
    metadata: {
      generatedAt: verificationTimestamp,
      searchRadiiMeters: [maxRadius],
      totalVerifiedPlaces: allPlaces.length,
      dataSource: 'OpenStreetMap (ODbL)'
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
    `Data Source: OpenStreetMap contributors (ODbL)`,
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
        if (p.types && p.types.length > 0) {
          parts.push(`Tags: [${p.types.slice(0, 3).join(', ')}]`);
        }
        if (p.openingHours && p.openingHours.length > 0) {
          parts.push(`Hours: "${p.openingHours[0]}"`);
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
