/**
 * Destination Resolution Service for TravelGenie.
 *
 * Resolves arbitrary user-entered destinations (including small villages,
 * rural settlements, misspelled queries, and remote destinations)
 * into authoritative geographic search anchors using OpenStreetMap Nominatim.
 *
 * Design Notes:
 * - Uses OpenStreetMap Nominatim for open, cost-conscious geocoding.
 * - Extracts canonical city/town/village name, full formatted address, coordinates,
 *   and administrative address components.
 * - Identifies ambiguous queries (e.g. same name in different regions) and rejects
 *   blindly selecting an arbitrary location.
 */

import {
  geocodeDestinationWithOsm,
  OsmRequestOptions,
  OsmNormalizedAddressComponent,
  OsmNoResultsError,
  OsmRequestError,
  DestinationAmbiguityError
} from './osmProvider.js';

export interface NormalizedAddressComponent {
  longName: string;
  shortName: string;
  types: string[];
}

export interface NormalizedViewport {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}

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
  /** Provider Place ID (e.g. "osm:node/123456" or "osm:relation/78910") */
  providerPlaceId?: string;
  /** Geocoding location type: 'node' | 'way' | 'relation' | 'APPROXIMATE' */
  locationType?: string;
  /** Breakdown of administrative address components */
  addressComponents: NormalizedAddressComponent[];
  /** Geographic viewport bounding box (display/viewport guidance only) */
  viewport?: NormalizedViewport;
}

export { DestinationAmbiguityError, OsmNoResultsError };

/**
 * Resolves an arbitrary destination string to a canonical geographic anchor.
 *
 * @param destination User-provided destination string (e.g. "Chandekasare", "Shirdi", "Pune", "Mumbai")
 * @param options Optional timeout, abort signal, or fetch override (for unit testing)
 * @returns Normalized resolved destination object
 */
export async function resolveDestination(
  destination: string,
  options: OsmRequestOptions = {}
): Promise<ResolvedDestination> {
  const cleanInput = destination?.trim();
  if (!cleanInput) {
    throw new OsmRequestError('Destination query cannot be empty or blank.', 400);
  }

  const geocode = await geocodeDestinationWithOsm(cleanInput, options);

  let viewport: NormalizedViewport | undefined;
  if (geocode.boundingbox && geocode.boundingbox.length === 4) {
    viewport = {
      southwest: { lat: geocode.boundingbox[0], lng: geocode.boundingbox[2] },
      northeast: { lat: geocode.boundingbox[1], lng: geocode.boundingbox[3] }
    };
  }

  const providerPlaceId = `osm:${geocode.osmType}/${geocode.osmId}`;

  console.log(
    `[DestinationResolver Diagnostics] Query="${cleanInput}" -> Canonical="${geocode.canonicalName}", ` +
    `Coords=(${geocode.latitude.toFixed(4)}, ${geocode.longitude.toFixed(4)}), Address="${geocode.formattedAddress}"`
  );

  return {
    originalInput: cleanInput,
    canonicalName: geocode.canonicalName,
    formattedAddress: geocode.formattedAddress,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    providerPlaceId,
    locationType: geocode.osmType,
    addressComponents: geocode.addressComponents,
    viewport
  };
}
