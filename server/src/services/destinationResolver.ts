/**
 * Destination Resolution Service for TravelGenie.
 *
 * Resolves arbitrary user-entered destinations (including small villages,
 * rural settlements, misspelled queries, and remote destinations)
 * into authoritative geographic search anchors using Google Geocoding.
 *
 * DESIGN NOTE:
 * Google Geocoding returns a center coordinate (geometry.location) and a
 * viewing bounding box (geometry.viewport). We treat the coordinates as the
 * authoritative geographic search anchor for subsequent radial POI searches.
 * We do NOT claim that Google's viewport is the exact legal or administrative
 * boundary of the destination settlement.
 */

import {
  geocodeDestination,
  GoogleRequestOptions,
  NormalizedAddressComponent,
  NormalizedViewport,
  GooglePlacesRequestError
} from './googlePlaces.js';

export interface ResolvedDestination {
  /** The raw input string entered by the user */
  originalInput: string;
  /** Primary human-readable settlement/city name */
  canonicalName: string;
  /** Full authoritative formatted address from provider */
  formattedAddress: string;
  /** Latitude coordinate in decimal degrees */
  latitude: number;
  /** Longitude coordinate in decimal degrees */
  longitude: number;
  /** Google Place ID if returned by the provider */
  providerPlaceId?: string;
  /** Geocoding location type: 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE' */
  locationType?: string;
  /** Breakdown of administrative address components */
  addressComponents: NormalizedAddressComponent[];
  /** Geographic viewport bounding box (display/viewport guidance only) */
  viewport?: NormalizedViewport;
}

/**
 * Derives a clean canonical destination name from address components.
 * Prioritizes locality -> postal_town -> administrative_area_level_2 -> first address segment.
 */
function deriveCanonicalName(
  formattedAddress: string,
  components: NormalizedAddressComponent[]
): string {
  const locality = components.find((c) => c.types.includes('locality'));
  if (locality?.longName?.trim()) {
    return locality.longName.trim();
  }

  const sublocality = components.find((c) => c.types.includes('sublocality') || c.types.includes('sublocality_level_1'));
  if (sublocality?.longName?.trim()) {
    return sublocality.longName.trim();
  }

  const postalTown = components.find((c) => c.types.includes('postal_town'));
  if (postalTown?.longName?.trim()) {
    return postalTown.longName.trim();
  }

  const admin2 = components.find((c) => c.types.includes('administrative_area_level_2'));
  if (admin2?.longName?.trim()) {
    return admin2.longName.trim();
  }

  const admin1 = components.find((c) => c.types.includes('administrative_area_level_1'));
  if (admin1?.longName?.trim()) {
    return admin1.longName.trim();
  }

  const firstSegment = formattedAddress.split(',')[0]?.trim();
  return firstSegment || formattedAddress;
}

/**
 * Resolves an arbitrary destination string to a canonical geographic anchor.
 *
 * @param destination User-provided destination string (e.g. "Chandekasare", "Shirdi", "Pune")
 * @param options Optional timeout, abort signal, or fetch override (for unit testing)
 * @returns Normalized resolved destination object
 * @throws GooglePlacesRequestError if input is empty or request is invalid
 * @throws GooglePlacesNoResultsError if the destination cannot be resolved
 * @throws GooglePlacesRateLimitError if quota is exceeded
 */
export async function resolveDestination(
  destination: string,
  options: GoogleRequestOptions = {}
): Promise<ResolvedDestination> {
  const cleanInput = destination?.trim();
  if (!cleanInput) {
    throw new GooglePlacesRequestError('Destination query cannot be empty or blank.', 400);
  }

  const geocode = await geocodeDestination(cleanInput, options);

  const canonicalName = deriveCanonicalName(geocode.formattedAddress, geocode.addressComponents);

  console.log(
    `[DestinationResolver Diagnostics] Query="${cleanInput}" -> Canonical="${canonicalName}", ` +
    `Coords=(${geocode.latitude.toFixed(4)}, ${geocode.longitude.toFixed(4)}), Address="${geocode.formattedAddress}"`
  );

  return {
    originalInput: cleanInput,
    canonicalName,
    formattedAddress: geocode.formattedAddress,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    providerPlaceId: geocode.providerPlaceId,
    locationType: geocode.locationType,
    addressComponents: geocode.addressComponents,
    viewport: geocode.viewport
  };
}
