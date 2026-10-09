/**
 * Unit tests for Phase 2A — Verified Place Catalog Builder.
 *
 * Verifies all 16 required integrity constraints:
 * 1. Google places are converted into VerifiedPlace correctly.
 * 2. Missing optional Google fields remain null.
 * 3. Missing providerPlaceId is rejected.
 * 4. Missing name is rejected.
 * 5. Duplicate providerPlaceId is deduplicated.
 * 6. Distance is calculated correctly.
 * 7. 0–5 km gets exact_destination.
 * 8. >5–15 km gets nearby.
 * 9. >15–25 km gets nearest_town.
 * 10. A place outside the maximum search radius (>25 km) is not included.
 * 11. If only one attraction exists, catalog contains one attraction and does not fabricate more.
 * 12. If no accommodation exists, accommodation array is empty.
 * 13. No estimated accommodation price is generated (null range, PRICE_LEVEL_ONLY / PRICE_UNAVAILABLE).
 * 14. Internal IDs are unique within a catalog (VP_01, VP_02, ...).
 * 15. Provider data is not mutated into fictional values.
 * 16. Catalog contains no duplicate providerPlaceIds across places array.
 *
 * All Google API requests are mocked; zero network calls are made.
 */

import assert from 'node:assert/strict';
import { InternalGooglePlace } from './src/services/googlePlaces.js';
import { ResolvedDestination } from './src/services/destinationResolver.js';
import {
  toVerifiedPlace,
  determineLocalityRelation,
  compareVerifiedPlaces,
  buildVerifiedPlaceCatalog,
  RADIUS_TIER_1_METERS,
  RADIUS_TIER_2_METERS,
  MAX_SEARCH_RADIUS_METERS
} from './src/services/placeCatalog.js';
import { clearOsmCache } from './src/services/osmProvider.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<void>)
        .then(() => {
          passedTests++;
          console.log(`  [PASS] ${name}`);
        })
        .catch((err) => {
          console.error(`  [FAIL] ${name}:`, err.message);
          throw err;
        });
    } else {
      passedTests++;
      console.log(`  [PASS] ${name}`);
      return Promise.resolve();
    }
  } catch (err: any) {
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// Sample destination anchor for Chandekasare (Rural village in Ahmednagar dist, Maharashtra)
const mockDestination: ResolvedDestination = {
  originalInput: 'Chandekasare',
  canonicalName: 'Chandekasare',
  formattedAddress: 'Chandekasare, Maharashtra 423601, India',
  latitude: 19.8654,
  longitude: 74.4812,
  providerPlaceId: 'ChIJ_chandekasare_anchor',
  locationType: 'APPROXIMATE',
  addressComponents: [
    { longName: 'Chandekasare', shortName: 'Chandekasare', types: ['locality'] },
    { longName: 'Maharashtra', shortName: 'MH', types: ['administrative_area_level_1'] }
  ]
};

async function runAllTests() {
  console.log('\n--- 1. Testing Single Place Conversion & Integrity ---');

  await runTest('1. Google places are converted into VerifiedPlace correctly', () => {
    const googlePlace: InternalGooglePlace = {
      providerPlaceId: 'ChIJ_valid_place_1',
      name: 'Shri Renuka Mata Mandir',
      formattedAddress: 'Main Road, Chandekasare',
      latitude: 19.8660,
      longitude: 74.4820,
      types: ['hindu_temple', 'place_of_worship'],
      rating: 4.6,
      userRatingCount: 85,
      googleMapsUri: 'https://maps.google.com/?cid=123',
      websiteUri: 'https://temple.example.com',
      phoneNumber: '02423 111 222',
      openingHours: ['Monday: 6:00 AM - 9:00 PM'],
      priceLevel: 'PRICE_LEVEL_INEXPENSIVE'
    };

    const verified = toVerifiedPlace(
      googlePlace,
      { latitude: mockDestination.latitude, longitude: mockDestination.longitude },
      'attraction',
      1,
      '2026-10-08T00:00:00.000Z'
    );

    assert.ok(verified, 'Expected verified place to be created');
    assert.equal(verified.internalId, 'VP_01');
    assert.equal(verified.provider, 'google_places');
    assert.equal(verified.providerPlaceId, 'ChIJ_valid_place_1');
    assert.equal(verified.name, 'Shri Renuka Mata Mandir');
    assert.equal(verified.primaryCategory, 'attraction');
    assert.deepEqual(verified.types, ['hindu_temple', 'place_of_worship']);
    assert.equal(verified.rating, 4.6);
    assert.equal(verified.userRatingCount, 85);
    assert.equal(verified.priceStatus, 'PRICE_LEVEL_ONLY');
    assert.equal(verified.estimatedPriceInrRange, null);
    assert.equal(verified.verificationTimestamp, '2026-10-08T00:00:00.000Z');
  });

  await runTest('2. Missing optional Google fields remain null', () => {
    const sparsePlace: InternalGooglePlace = {
      providerPlaceId: 'ChIJ_sparse_place',
      name: 'Village Shrine',
      formattedAddress: 'Chandekasare',
      latitude: 19.8655,
      longitude: 74.4815,
      types: ['place_of_worship'],
      rating: null,
      userRatingCount: null,
      googleMapsUri: null,
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null
    };

    const verified = toVerifiedPlace(
      sparsePlace,
      { latitude: mockDestination.latitude, longitude: mockDestination.longitude },
      'attraction',
      2,
      '2026-10-08T00:00:00.000Z'
    );

    assert.ok(verified);
    assert.equal(verified.rating, null);
    assert.equal(verified.userRatingCount, null);
    assert.equal(verified.googleMapsUri, null);
    assert.equal(verified.websiteUri, null);
    assert.equal(verified.phoneNumber, null);
    assert.equal(verified.openingHours, null);
    assert.equal(verified.priceLevel, null);
    assert.equal(verified.priceStatus, 'PRICE_UNAVAILABLE');
    assert.equal(verified.estimatedPriceInrRange, null);
  });

  await runTest('3. Missing providerPlaceId is rejected (returns null)', () => {
    const invalidPlace: InternalGooglePlace = {
      providerPlaceId: '',
      name: 'Place without ID',
      formattedAddress: '',
      latitude: 19.8655,
      longitude: 74.4815,
      types: [],
      rating: null,
      userRatingCount: null,
      googleMapsUri: null,
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null
    };

    const verified = toVerifiedPlace(
      invalidPlace,
      { latitude: mockDestination.latitude, longitude: mockDestination.longitude },
      'attraction',
      1,
      '2026-10-08T00:00:00.000Z'
    );

    assert.equal(verified, null, 'Must reject places with missing providerPlaceId');
  });

  await runTest('4. Missing name or default placeholder is rejected (returns null)', () => {
    const invalidPlace1: any = {
      providerPlaceId: 'ChIJ_no_name',
      name: '',
      latitude: 19.8655,
      longitude: 74.4815
    };
    const invalidPlace2: any = {
      providerPlaceId: 'ChIJ_placeholder_name',
      name: 'Unknown Place',
      latitude: 19.8655,
      longitude: 74.4815
    };

    assert.equal(
      toVerifiedPlace(invalidPlace1, mockDestination, 'attraction', 1, '2026-10-08T00:00:00.000Z'),
      null
    );
    assert.equal(
      toVerifiedPlace(invalidPlace2, mockDestination, 'attraction', 1, '2026-10-08T00:00:00.000Z'),
      null
    );
  });

  console.log('\n--- 2. Testing Distance Calculation & Locality Relation Tiers ---');

  await runTest('6. Distance is calculated correctly via Haversine', () => {
    // A point ~1 km away
    const place1km: InternalGooglePlace = {
      providerPlaceId: 'ChIJ_1km',
      name: 'Nearby School',
      formattedAddress: 'Near Chandekasare',
      latitude: 19.8744,
      longitude: 74.4812,
      types: [],
      rating: null,
      userRatingCount: null,
      googleMapsUri: null,
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null
    };

    const verified = toVerifiedPlace(place1km, mockDestination, 'poi', 1, '2026-10-08T00:00:00.000Z');
    assert.ok(verified);
    // Difference in latitude is 0.009 deg ~ 1000m
    assert.ok(verified.distanceMeters >= 950 && verified.distanceMeters <= 1050, `Distance was ${verified.distanceMeters}m`);
  });

  await runTest('7. 0-5 km gets exact_destination', () => {
    assert.equal(determineLocalityRelation(0), 'exact_destination');
    assert.equal(determineLocalityRelation(2500), 'exact_destination');
    assert.equal(determineLocalityRelation(RADIUS_TIER_1_METERS), 'exact_destination');
  });

  await runTest('8. >5-15 km gets nearby', () => {
    assert.equal(determineLocalityRelation(5001), 'nearby');
    assert.equal(determineLocalityRelation(10000), 'nearby');
    assert.equal(determineLocalityRelation(RADIUS_TIER_2_METERS), 'nearby');
  });

  await runTest('9. >15-25 km gets nearest_town', () => {
    assert.equal(determineLocalityRelation(15001), 'nearest_town');
    assert.equal(determineLocalityRelation(20000), 'nearest_town');
    assert.equal(determineLocalityRelation(MAX_SEARCH_RADIUS_METERS), 'nearest_town');
  });

  await runTest('10. A place outside maximum search radius (>25 km) is excluded', () => {
    // Point in Pune (~160 km from Chandekasare)
    const farPlace: InternalGooglePlace = {
      providerPlaceId: 'ChIJ_pune_far',
      name: 'Faraway Hotel',
      formattedAddress: 'Pune, Maharashtra',
      latitude: 18.5204,
      longitude: 73.8567,
      types: ['hotel'],
      rating: 4.5,
      userRatingCount: 1000,
      googleMapsUri: null,
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null
    };

    const verified = toVerifiedPlace(farPlace, mockDestination, 'accommodation', 1, '2026-10-08T00:00:00.000Z');
    assert.equal(verified, null, 'Must reject places with distance > 25,000m');
  });

  console.log('\n--- 3. Testing Catalog Builder & Rural Destination Fallback ---');

  await runTest('11 & 12. Rural destination honesty: 0 accommodation, 1 attraction', async () => {
    clearOsmCache();
    // Mock Overpass provider response:
    // - 0 accommodations
    // - 1 real attraction at Tier 1 (village temple: 0.3km away)
    // - 2 restaurants at Tier 2 (highway dhabas: 6.2km and 8.4km away)
    // - 0 activities
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: 'node',
              id: 101,
              lat: 19.8658,
              lon: 74.4816,
              tags: {
                name: 'Shri Ram Mandir Chandekasare',
                amenity: 'place_of_worship',
                religion: 'hindu'
              }
            },
            {
              type: 'node',
              id: 201,
              lat: 19.8100,
              lon: 74.4700,
              tags: {
                name: 'Kisan Dhaba',
                amenity: 'restaurant'
              }
            },
            {
              type: 'node',
              id: 202,
              lat: 19.7900,
              lon: 74.4700,
              tags: {
                name: 'Hotel Sai Prasad Food',
                amenity: 'restaurant'
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const catalog = await buildVerifiedPlaceCatalog(mockDestination, {
      fetchFn: mockFetch,
      verificationTimestamp: '2026-10-08T01:00:00.000Z'
    });

    // Integrity Rule 12: If no accommodation exists, accommodation array is empty
    assert.equal(catalog.byCategory.accommodation.length, 0);

    // Integrity Rule 11: If only 1 attraction exists, catalog contains 1 attraction (does NOT fabricate more)
    assert.equal(catalog.byCategory.attraction.length, 1);
    assert.equal(catalog.byCategory.attraction[0].name, 'Shri Ram Mandir Chandekasare');
    assert.equal(catalog.byCategory.attraction[0].localityRelation, 'exact_destination');

    // Restaurants found at 15km tier:
    assert.equal(catalog.byCategory.restaurant.length, 2);
    assert.equal(catalog.byCategory.restaurant[0].localityRelation, 'nearby');
    assert.equal(catalog.byCategory.restaurant[1].localityRelation, 'nearby');

    // Total verified places in catalog: 1 temple + 2 dhabas = 3
    assert.equal(catalog.places.length, 3);
    assert.equal(catalog.metadata.totalVerifiedPlaces, 3);
  });

  await runTest('5 & 16. Deduplication: Duplicate providerPlaceIds across search tiers are deduplicated', async () => {
    clearOsmCache();
    // Mock returns the SAME hotel in both node and duplicate way form
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              type: 'node',
              id: 501,
              lat: 19.8654,
              lon: 74.4812,
              tags: {
                name: 'Hotel Sai Residency',
                tourism: 'hotel'
              }
            },
            {
              type: 'node',
              id: 501, // same ID duplicated
              lat: 19.8654,
              lon: 74.4812,
              tags: {
                name: 'Hotel Sai Residency',
                tourism: 'hotel'
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const catalog = await buildVerifiedPlaceCatalog(mockDestination, {
      fetchFn: mockFetch,
      minAccommodation: 5
    });

    const accomIds = catalog.byCategory.accommodation.map((p) => p.providerPlaceId);
    assert.equal(accomIds.length, 1, 'Duplicate hotel was not deduplicated');
    assert.equal(accomIds[0], 'osm:node/501');

    // Global places array must also have unique providerPlaceIds
    const allIds = catalog.places.map((p) => p.providerPlaceId);
    const uniqueIds = new Set(allIds);
    assert.equal(allIds.length, uniqueIds.size, 'Master places list contains duplicate IDs');
  });

  await runTest('13. No estimated accommodation price is generated', async () => {
    clearOsmCache();
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              type: 'node',
              id: 601,
              lat: 19.8654,
              lon: 74.4812,
              tags: {
                name: 'Grand Inn',
                tourism: 'hotel'
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const catalog = await buildVerifiedPlaceCatalog(mockDestination, { fetchFn: mockFetch });

    for (const place of catalog.places) {
      assert.equal(place.estimatedPriceInrRange, null, 'Must NOT generate estimated price');
      assert.ok(
        place.priceStatus === 'PRICE_LEVEL_ONLY' || place.priceStatus === 'PRICE_UNAVAILABLE',
        `Unexpected price status: ${place.priceStatus}`
      );
    }
  });

  await runTest('14. Internal IDs are unique and sequential within a catalog (VP_01, VP_02, ...)', async () => {
    clearOsmCache();
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: 'node',
              id: 701,
              lat: 19.8654,
              lon: 74.4812,
              tags: { name: 'Place Number 1', tourism: 'attraction' }
            },
            {
              type: 'node',
              id: 702,
              lat: 19.8655,
              lon: 74.4813,
              tags: { name: 'Place Number 2', tourism: 'attraction' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const catalog = await buildVerifiedPlaceCatalog(mockDestination, { fetchFn: mockFetch });

    assert.ok(catalog.places.length > 0);
    const ids = catalog.places.map((p) => p.internalId);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'Internal IDs are not unique');

    // Confirm pattern VP_01, VP_02, ...
    assert.equal(catalog.places[0].internalId, 'VP_01');
    if (catalog.places.length > 1) {
      assert.equal(catalog.places[1].internalId, 'VP_02');
    }
  });

  await runTest('15. Provider data is not mutated into fictional values', async () => {
    clearOsmCache();
    const originalName = 'Exact Authentic Name From Provider 123';
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              type: 'node',
              id: 801,
              lat: 19.8654,
              lon: 74.4812,
              tags: {
                name: originalName,
                amenity: 'restaurant'
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const catalog = await buildVerifiedPlaceCatalog(mockDestination, { fetchFn: mockFetch });

    assert.equal(catalog.places[0].name, originalName, 'Place name was mutated');
  });

  await runTest('Deterministic ranking: Orders by locality relation, rating, review count, and tie-breakers', () => {
    const p1: any = {
      internalId: 'VP_01',
      name: 'Place Alpha',
      providerPlaceId: 'P1',
      distanceMeters: 1000,
      localityRelation: 'exact_destination',
      rating: 4.8,
      userRatingCount: 200
    };
    const p2: any = {
      internalId: 'VP_02',
      name: 'Place Beta',
      providerPlaceId: 'P2',
      distanceMeters: 8000,
      localityRelation: 'nearby',
      rating: 4.9, // Higher rating but farther locality
      userRatingCount: 500
    };
    const p3: any = {
      internalId: 'VP_03',
      name: 'Place Gamma',
      providerPlaceId: 'P3',
      distanceMeters: 2000,
      localityRelation: 'exact_destination',
      rating: 4.2,
      userRatingCount: 50
    };

    // p1 should rank before p2 (exact_destination beats nearby)
    assert.ok(compareVerifiedPlaces(p1, p2) < 0);
    // p1 should rank before p3 (same locality, but p1 has higher rating)
    assert.ok(compareVerifiedPlaces(p1, p3) < 0);

    const list = [p2, p3, p1];
    list.sort(compareVerifiedPlaces);
    assert.deepEqual(list.map((p) => p.name), ['Place Alpha', 'Place Gamma', 'Place Beta']);
  });

  console.log(`\n========================================`);
  console.log(`All Phase 2A Place Catalog Tests Passed! (${passedTests}/${totalTests})`);
  console.log(`========================================\n`);
}

runAllTests().catch((err) => {
  console.error('\nTest suite execution failed:', err);
  process.exit(1);
});
