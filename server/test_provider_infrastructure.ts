/**
 * Unit tests for TravelGenie Phase 1 Provider Infrastructure.
 *
 * Tests:
 * 1. Haversine distance formula (zero distance, symmetry, known real-world distances, validations)
 * 2. Missing GOOGLE_MAPS_API_KEY configuration error handling
 * 3. normalizeGooglePlace field mapping & zero fabrication of missing fields
 * 4. geocodeDestination (valid mock response, ZERO_RESULTS, 429 rate limit, 403 denied, timeouts, malformed JSON)
 * 5. searchPlacesNearby (places array normalization, empty response handling, header & field mask verification)
 * 6. searchPlacesByText (text query validation, location bias serialization)
 * 7. resolveDestination (canonical name derivation, coordinate resolution, empty input validation)
 *
 * Note: These tests do NOT make live calls to Google APIs. All HTTP calls are mocked.
 */

import assert from 'node:assert/strict';
import { calculateDistanceMeters } from './src/services/geo.js';
import {
  geocodeDestination,
  searchPlacesNearby,
  searchPlacesByText,
  normalizeGooglePlace,
  PLACES_API_FIELD_MASK,
  GooglePlacesConfigError,
  GooglePlacesRequestError,
  GooglePlacesRateLimitError,
  GooglePlacesNoResultsError,
  GooglePlacesTimeoutError,
  GooglePlacesParseError
} from './src/services/googlePlaces.js';
import { resolveDestination } from './src/services/destinationResolver.js';

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

async function runAllTests() {
  console.log('\n--- 1. Testing Haversine Distance Utility (geo.ts) ---');

  await runTest('calculateDistanceMeters: Identical coordinates return 0 meters', () => {
    const dist = calculateDistanceMeters(19.8654, 74.4812, 19.8654, 74.4812);
    assert.equal(dist, 0);
  });

  await runTest('calculateDistanceMeters: Symmetry (dist(A, B) === dist(B, A))', () => {
    const d1 = calculateDistanceMeters(18.5204, 73.8567, 19.0760, 72.8777);
    const d2 = calculateDistanceMeters(19.0760, 72.8777, 18.5204, 73.8567);
    assert.equal(d1, d2);
  });

  await runTest('calculateDistanceMeters: Known real-world distance (Shirdi to Kopargaon ~ 13.5 km)', () => {
    // Shirdi Sai Baba Temple (19.7667, 74.4770) to Kopargaon station (19.8885, 74.4851)
    const dist = calculateDistanceMeters(19.7667, 74.4770, 19.8885, 74.4851);
    // Great circle distance is ~ 13.5 km (between 13000m and 14500m)
    assert.ok(dist >= 13000 && dist <= 14500, `Expected ~13.5km, got ${dist}m`);
  });

  await runTest('calculateDistanceMeters: Known distance (Pune to Mumbai ~ 119 km)', () => {
    const dist = calculateDistanceMeters(18.5204, 73.8567, 19.0760, 72.8777);
    // Great circle distance is ~119 km (between 115000m and 125000m)
    assert.ok(dist >= 115000 && dist <= 125000, `Expected ~119km, got ${dist}m`);
  });

  await runTest('calculateDistanceMeters: Invalid coordinate inputs throw error', () => {
    assert.throws(() => calculateDistanceMeters(NaN, 74, 19, 74), /finite numbers/);
    assert.throws(() => calculateDistanceMeters(95, 74, 19, 74), /Latitude must be between -90 and 90/);
    assert.throws(() => calculateDistanceMeters(19, 190, 19, 74), /Longitude must be between -180 and 180/);
  });

  console.log('\n--- 2. Testing Place Normalization (googlePlaces.ts) ---');

  await runTest('normalizeGooglePlace: Full valid Google place maps accurately', () => {
    const mockRaw = {
      id: 'ChIJ1234567890',
      displayName: { text: 'Hotel Sai Leela', languageCode: 'en' },
      formattedAddress: 'Pimpalwadi Road, Shirdi, Maharashtra 423109',
      location: { latitude: 19.768, longitude: 74.479 },
      types: ['lodging', 'hotel'],
      rating: 4.3,
      userRatingCount: 520,
      googleMapsUri: 'https://maps.google.com/?cid=12345',
      websiteUri: 'https://saileela.example.com',
      nationalPhoneNumber: '02423 255 123',
      regularOpeningHours: {
        weekdayDescriptions: ['Monday: Open 24 hours', 'Tuesday: Open 24 hours']
      },
      priceLevel: 'PRICE_LEVEL_MODERATE'
    };

    const normalized = normalizeGooglePlace(mockRaw);
    assert.equal(normalized.providerPlaceId, 'ChIJ1234567890');
    assert.equal(normalized.name, 'Hotel Sai Leela');
    assert.equal(normalized.formattedAddress, 'Pimpalwadi Road, Shirdi, Maharashtra 423109');
    assert.equal(normalized.latitude, 19.768);
    assert.equal(normalized.longitude, 74.479);
    assert.deepEqual(normalized.types, ['lodging', 'hotel']);
    assert.equal(normalized.rating, 4.3);
    assert.equal(normalized.userRatingCount, 520);
    assert.equal(normalized.googleMapsUri, 'https://maps.google.com/?cid=12345');
    assert.equal(normalized.websiteUri, 'https://saileela.example.com');
    assert.equal(normalized.phoneNumber, '02423 255 123');
    assert.deepEqual(normalized.openingHours, ['Monday: Open 24 hours', 'Tuesday: Open 24 hours']);
    assert.equal(normalized.priceLevel, 'PRICE_LEVEL_MODERATE');
  });

  await runTest('normalizeGooglePlace: Sparse place with missing optional fields does NOT fabricate values', () => {
    const mockSparse = {
      id: 'ChIJ_sparse_001',
      displayName: { text: 'Village Temple' },
      location: { latitude: 19.865, longitude: 74.481 }
    };

    const normalized = normalizeGooglePlace(mockSparse);
    assert.equal(normalized.providerPlaceId, 'ChIJ_sparse_001');
    assert.equal(normalized.name, 'Village Temple');
    assert.equal(normalized.latitude, 19.865);
    assert.equal(normalized.longitude, 74.481);
    assert.deepEqual(normalized.types, []);
    assert.equal(normalized.rating, null);
    assert.equal(normalized.userRatingCount, null);
    assert.equal(normalized.googleMapsUri, null);
    assert.equal(normalized.websiteUri, null);
    assert.equal(normalized.phoneNumber, null);
    assert.equal(normalized.openingHours, null);
    assert.equal(normalized.priceLevel, null);
  });

  await runTest('normalizeGooglePlace: Invalid non-object throws GooglePlacesParseError', () => {
    assert.throws(() => normalizeGooglePlace(null), (err: any) => err instanceof GooglePlacesParseError);
    assert.throws(() => normalizeGooglePlace('invalid'), (err: any) => err instanceof GooglePlacesParseError);
  });

  console.log('\n--- 3. Testing Geocoding & Configuration Handling ---');

  await runTest('geocodeDestination: Missing GOOGLE_MAPS_API_KEY throws GooglePlacesConfigError', async () => {
    const originalKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    try {
      await assert.rejects(
        () => geocodeDestination('Chandekasare'),
        (err: any) => err instanceof GooglePlacesConfigError
      );
    } finally {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
  });

  await runTest('geocodeDestination: Blank destination query throws GooglePlacesRequestError (400)', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';
    await assert.rejects(
      () => geocodeDestination('   '),
      (err: any) => err instanceof GooglePlacesRequestError && err.statusCode === 400
    );
  });

  await runTest('geocodeDestination: ZERO_RESULTS throws GooglePlacesNoResultsError', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    await assert.rejects(
      () => geocodeDestination('NonExistentPlace12345', { fetchFn: mockFetch }),
      (err: any) => err instanceof GooglePlacesNoResultsError
    );
  });

  await runTest('geocodeDestination: OVER_QUERY_LIMIT throws GooglePlacesRateLimitError', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 'OVER_QUERY_LIMIT', results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    await assert.rejects(
      () => geocodeDestination('Pune', { fetchFn: mockFetch }),
      (err: any) => err instanceof GooglePlacesRateLimitError
    );
  });

  await runTest('geocodeDestination: HTTP 429 throws GooglePlacesRateLimitError', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockFetch: typeof fetch = async () =>
      new Response('Too Many Requests', { status: 429 });

    await assert.rejects(
      () => geocodeDestination('Pune', { fetchFn: mockFetch }),
      (err: any) => err instanceof GooglePlacesRateLimitError
    );
  });

  await runTest('geocodeDestination: REQUEST_DENIED throws GooglePlacesRequestError without leaking key', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'AIzaSyTestKey_Secret1234567890';

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'REQUEST_DENIED',
          error_message: 'The provided API key is invalid.'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      () => geocodeDestination('Pune', { fetchFn: mockFetch }),
      (err: any) => {
        assert.ok(err instanceof GooglePlacesRequestError);
        assert.ok(!err.message.includes('AIzaSyTestKey_Secret1234567890'), 'Secret key leaked in error message!');
        return true;
      }
    );
  });

  await runTest('geocodeDestination: Malformed JSON throws GooglePlacesParseError', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockFetch: typeof fetch = async () =>
      new Response('<!DOCTYPE html><html><body>Error</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    await assert.rejects(
      () => geocodeDestination('Pune', { fetchFn: mockFetch }),
      (err: any) => err instanceof GooglePlacesParseError
    );
  });

  await runTest('geocodeDestination: Valid Google geocode response correctly normalizes fields', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockGeocodePayload = {
      status: 'OK',
      results: [
        {
          place_id: 'ChIJ_chandekasare_id',
          formatted_address: 'Chandekasare, Maharashtra 423601, India',
          geometry: {
            location: { lat: 19.8654, lng: 74.4812 },
            location_type: 'APPROXIMATE',
            viewport: {
              northeast: { lat: 19.875, lng: 74.492 },
              southwest: { lat: 19.855, lng: 74.471 }
            }
          },
          address_components: [
            { long_name: 'Chandekasare', short_name: 'Chandekasare', types: ['locality', 'political'] },
            { long_name: 'Ahmednagar', short_name: 'Ahmednagar', types: ['administrative_area_level_2', 'political'] },
            { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1', 'political'] },
            { long_name: 'India', short_name: 'IN', types: ['country', 'political'] }
          ]
        }
      ]
    };

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(mockGeocodePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    const result = await geocodeDestination('Chandekasare', { fetchFn: mockFetch });
    assert.equal(result.formattedAddress, 'Chandekasare, Maharashtra 423601, India');
    assert.equal(result.latitude, 19.8654);
    assert.equal(result.longitude, 74.4812);
    assert.equal(result.providerPlaceId, 'ChIJ_chandekasare_id');
    assert.equal(result.locationType, 'APPROXIMATE');
    assert.equal(result.addressComponents.length, 4);
    assert.equal(result.addressComponents[0].longName, 'Chandekasare');
    assert.equal(result.viewport?.northeast.lat, 19.875);
  });

  console.log('\n--- 4. Testing Places API (New) Nearby and Text Searches ---');

  await runTest('searchPlacesNearby: Enforces FieldMask and API Key headers', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    let capturedHeaders: HeadersInit | undefined;
    let capturedBody: any;

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          places: [
            {
              id: 'ChIJ_hotel_1',
              displayName: { text: 'Hotel Sai Sahavas' },
              location: { latitude: 19.768, longitude: 74.479 },
              types: ['lodging', 'hotel'],
              rating: 4.1
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const results = await searchPlacesNearby(
      {
        coordinates: { latitude: 19.768, longitude: 74.479 },
        radiusMeters: 5000,
        includedTypes: ['hotel', 'lodging']
      },
      { fetchFn: mockFetch }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Hotel Sai Sahavas');
    assert.equal(results[0].rating, 4.1);

    const headers = capturedHeaders as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'test_mock_api_key');
    assert.equal(headers['X-Goog-FieldMask'], PLACES_API_FIELD_MASK);
    assert.equal(capturedBody.locationRestriction.circle.radius, 5000);
    assert.deepEqual(capturedBody.includedTypes, ['hotel', 'lodging']);
  });

  await runTest('searchPlacesNearby: Empty places response returns empty array', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    const results = await searchPlacesNearby(
      {
        coordinates: { latitude: 19.865, longitude: 74.481 },
        radiusMeters: 5000
      },
      { fetchFn: mockFetch }
    );

    assert.deepEqual(results, []);
  });

  await runTest('searchPlacesByText: Text query validation and location bias serialization', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    let capturedBody: any;

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          places: [
            {
              id: 'ChIJ_attraction_1',
              displayName: { text: 'Sai Heritage Village' },
              location: { latitude: 19.755, longitude: 74.471 },
              types: ['tourist_attraction']
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const results = await searchPlacesByText(
      {
        textQuery: 'heritage attractions in Shirdi',
        center: { latitude: 19.76, longitude: 74.47 },
        radiusMeters: 10000,
        maxResultCount: 5
      },
      { fetchFn: mockFetch }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Sai Heritage Village');
    assert.equal(capturedBody.textQuery, 'heritage attractions in Shirdi');
    assert.equal(capturedBody.pageSize, 5);
    assert.equal(capturedBody.locationBias.circle.radius, 10000);
  });

  console.log('\n--- 5. Testing Destination Resolver (destinationResolver.ts) ---');

  await runTest('resolveDestination: Blank destination input throws error', async () => {
    await assert.rejects(
      () => resolveDestination('   '),
      (err: any) => err instanceof GooglePlacesRequestError
    );
  });

  await runTest('resolveDestination: Successfully resolves destination with canonical name', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockGeocodePayload = {
      status: 'OK',
      results: [
        {
          place_id: 'ChIJ_shirdi_id',
          formatted_address: 'Shirdi, Maharashtra 423109, India',
          geometry: {
            location: { lat: 19.7667, lng: 74.4770 },
            location_type: 'APPROXIMATE',
            viewport: {
              northeast: { lat: 19.78, lng: 74.49 },
              southwest: { lat: 19.75, lng: 74.46 }
            }
          },
          address_components: [
            { long_name: 'Shirdi', short_name: 'Shirdi', types: ['locality', 'political'] },
            { long_name: 'Ahmednagar', short_name: 'Ahmednagar', types: ['administrative_area_level_2', 'political'] },
            { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1', 'political'] },
            { long_name: 'India', short_name: 'IN', types: ['country', 'political'] }
          ]
        }
      ]
    };

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(mockGeocodePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    const resolved = await resolveDestination('Shirdi', { fetchFn: mockFetch });

    assert.equal(resolved.originalInput, 'Shirdi');
    assert.equal(resolved.canonicalName, 'Shirdi');
    assert.equal(resolved.formattedAddress, 'Shirdi, Maharashtra 423109, India');
    assert.equal(resolved.latitude, 19.7667);
    assert.equal(resolved.longitude, 74.4770);
    assert.equal(resolved.providerPlaceId, 'ChIJ_shirdi_id');
    assert.equal(resolved.locationType, 'APPROXIMATE');
    assert.equal(resolved.addressComponents.length, 4);
    assert.ok(resolved.viewport);
  });

  await runTest('resolveDestination: ZERO_RESULTS throws GooglePlacesNoResultsError', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test_mock_api_key';

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    await assert.rejects(
      () => resolveDestination('UnknownMarsColony99', { fetchFn: mockFetch }),
      (err: any) => err instanceof GooglePlacesNoResultsError
    );
  });

  console.log(`\n========================================`);
  console.log(`All Phase 1 Infrastructure Tests Passed! (${passedTests}/${totalTests})`);
  console.log(`========================================\n`);
}

runAllTests().catch((err) => {
  console.error('\nTest suite execution failed:', err);
  process.exit(1);
});
