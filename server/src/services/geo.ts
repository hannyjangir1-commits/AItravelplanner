/**
 * Geographic calculation utilities for TravelGenie place verification.
 * Implements geodesic distance calculations using the Haversine formula
 * without external heavy GIS dependencies.
 */

const EARTH_RADIUS_METERS = 6371000; // Mean Earth radius in meters (WGS84 approx)

/**
 * Converts decimal degrees to radians.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates the great-circle distance between two geographic coordinates
 * using the standard Haversine formula.
 *
 * @param lat1 Latitude of coordinate 1 in decimal degrees (-90 to 90)
 * @param lng1 Longitude of coordinate 1 in decimal degrees (-180 to 180)
 * @param lat2 Latitude of coordinate 2 in decimal degrees (-90 to 90)
 * @param lng2 Longitude of coordinate 2 in decimal degrees (-180 to 180)
 * @returns Geodesic distance in meters (rounded to nearest integer)
 * @throws Error if coordinates are non-numeric or out of valid geographic ranges
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    throw new Error('All coordinate inputs must be finite numbers.');
  }

  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees.');
  }

  if (lng1 < -180 || lng1 > 180 || lng2 < -180 || lng2 > 180) {
    throw new Error('Longitude must be between -180 and 180 degrees.');
  }

  // Exact same point edge case
  if (lat1 === lat2 && lng1 === lng2) {
    return 0;
  }

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lng2 - lng1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  // Guard against slight floating point inaccuracies exceeding 1
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));

  return Math.round(EARTH_RADIUS_METERS * c);
}
