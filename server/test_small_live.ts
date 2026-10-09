/**
 * Small bounded live test for OpenStreetMap Nominatim and Overpass API.
 * Times out strictly after 10s (Nominatim) and 20s (Overpass).
 * Prints HTTP status, elapsed time, and concise details.
 */

import { geocodeDestinationWithOsm, searchOsmPlacesNearby } from './src/services/osmProvider.js';

async function runSmallLiveTest() {
  console.log('=== SMALL BOUNDED LIVE TEST ===\n');

  // Test 1: Nominatim Geocoding
  console.log('Testing Live Nominatim Geocode ("Mumbai")...');
  const startGeo = Date.now();
  try {
    const geo = await geocodeDestinationWithOsm('Mumbai', { timeoutMs: 10000 });
    const elapsedGeo = Date.now() - startGeo;
    console.log(`[NOMINATIM OK] Elapsed: ${elapsedGeo}ms | Canonical: "${geo.canonicalName}" | Lat: ${geo.latitude.toFixed(4)}, Lon: ${geo.longitude.toFixed(4)}`);
  } catch (err: any) {
    const elapsedGeo = Date.now() - startGeo;
    console.log(`[NOMINATIM FAILED] Elapsed: ${elapsedGeo}ms | Error: ${err.message}`);
    process.exit(1);
  }

  // Test 2: Overpass POI Discovery (5km radius, small bounded)
  console.log('\nTesting Live Overpass POI Discovery ("Mumbai", 5000m radius)...');
  const startOverpass = Date.now();
  try {
    const places = await searchOsmPlacesNearby(
      {
        coordinates: { latitude: 19.055, longitude: 72.869 },
        radiusMeters: 5000,
        maxResults: 100
      },
      { timeoutMs: 20000 }
    );
    const elapsedOverpass = Date.now() - startOverpass;
    const accom = places.filter(p => p.categoryHint === 'accommodation').length;
    const attr = places.filter(p => p.categoryHint === 'attraction').length;
    const rest = places.filter(p => p.categoryHint === 'restaurant').length;
    console.log(`[OVERPASS OK] Elapsed: ${elapsedOverpass}ms | Total POIs: ${places.length} | Accommodations: ${accom} | Attractions: ${attr} | Dining: ${rest}`);
  } catch (err: any) {
    const elapsedOverpass = Date.now() - startOverpass;
    console.log(`[OVERPASS FAILED] Elapsed: ${elapsedOverpass}ms | Error: ${err.message}`);
    process.exit(1);
  }

  console.log('\n=== SMALL BOUNDED LIVE TEST PASSED ===');
}

runSmallLiveTest().catch(err => {
  console.error('Unhandled Failure:', err);
  process.exit(1);
});
