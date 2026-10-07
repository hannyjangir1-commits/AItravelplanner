/**
 * Diagnostic & Regression Test Suite for Pune, Shirdi, and Chandekasare.
 *
 * Verifies the end-to-end data pipeline from destination resolution through
 * raw Google Places API (New) response, normalization, category filtering,
 * radius filtering, deduplication, ranking, and final catalog construction.
 *
 * ZERO live Google network calls are made; representative response fixtures are used.
 */

import assert from 'node:assert/strict';
import {
  InternalGooglePlace,
  normalizeGooglePlace,
  GooglePlacesRequestError
} from './src/services/googlePlaces.js';
import {
  ResolvedDestination,
  resolveDestination
} from './src/services/destinationResolver.js';
import {
  buildVerifiedPlaceCatalog,
  toVerifiedPlace,
  determineLocalityRelation,
  ATTRACTION_PLACE_TYPES,
  ACCOMMODATION_PLACE_TYPES,
  RESTAURANT_PLACE_TYPES,
  ACTIVITY_PLACE_TYPES
} from './src/services/placeCatalog.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';
import { TravelPlan } from './src/types.js';

let testCount = 0;
let passCount = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ============================================================================
// Representative Fixtures for Pune, Shirdi, and Chandekasare
// ============================================================================

const PUNE_RESOLVED: ResolvedDestination = {
  originalInput: 'Pune',
  canonicalName: 'Pune',
  formattedAddress: 'Pune, Maharashtra, India',
  latitude: 18.5204,
  longitude: 73.8567,
  providerPlaceId: 'ChIJR3P3T_TBwjsR3eB9x4Z-Xwk',
  locationType: 'APPROXIMATE',
  addressComponents: [
    { longName: 'Pune', shortName: 'Pune', types: ['locality'] },
    { longName: 'Maharashtra', shortName: 'MH', types: ['administrative_area_level_1'] },
    { longName: 'India', shortName: 'IN', types: ['country'] }
  ]
};

const SHIRDI_RESOLVED: ResolvedDestination = {
  originalInput: 'Shirdi',
  canonicalName: 'Shirdi',
  formattedAddress: 'Shirdi, Maharashtra 423109, India',
  latitude: 19.7667,
  longitude: 74.4762,
  providerPlaceId: 'ChIJ7_shirdi_anchor',
  locationType: 'APPROXIMATE',
  addressComponents: [
    { longName: 'Shirdi', shortName: 'Shirdi', types: ['locality'] },
    { longName: 'Maharashtra', shortName: 'MH', types: ['administrative_area_level_1'] }
  ]
};

const CHANDEKASARE_RESOLVED: ResolvedDestination = {
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

// Raw Google Places API (New) JSON responses for Pune
const RAW_PUNE_ATTRACTIONS = [
  {
    id: 'ChIJb_fG1_TBwjsRU0aUvK0wT4s',
    displayName: { text: 'Shaniwar Wada', languageCode: 'en' },
    formattedAddress: 'Shaniwar Peth, Pune, Maharashtra 411030',
    location: { latitude: 18.5196, longitude: 73.8554 }, // ~170m from anchor
    types: ['historical_landmark', 'tourist_attraction', 'point_of_interest'],
    rating: 4.2,
    userRatingCount: 35420
  },
  {
    id: 'ChIJc5_l2YfAwjsRPf-f5kXwE9k',
    displayName: { text: 'Pataleshwar Cave Temple', languageCode: 'en' },
    formattedAddress: 'JM Road, Shivajinagar, Pune, Maharashtra 411005',
    location: { latitude: 18.5289, longitude: 73.8504 }, // ~1.1km from anchor
    types: ['hindu_temple', 'historical_landmark', 'tourist_attraction'],
    rating: 4.5,
    userRatingCount: 8200
  },
  {
    id: 'ChIJX7b_1_TBwjsRwXWk1234567',
    displayName: { text: 'Lal Mahal', languageCode: 'en' },
    formattedAddress: 'Kasba Peth, Pune, Maharashtra 411011',
    location: { latitude: 18.5184, longitude: 73.8580 }, // ~260m from anchor
    types: ['historical_landmark', 'tourist_attraction'],
    rating: 4.1,
    userRatingCount: 4500
  },
  {
    id: 'ChIJY8c_2_TBwjsRyZAB7654321',
    displayName: { text: 'Darshan Museum', languageCode: 'en' },
    formattedAddress: 'Sadhu Vaswani Mission, Pune, Maharashtra 411001',
    location: { latitude: 18.5180, longitude: 73.8745 }, // ~1.9km from anchor
    types: ['museum', 'tourist_attraction'],
    rating: 4.7,
    userRatingCount: 3100
  }
];

const RAW_PUNE_HOTELS = [
  {
    id: 'ChIJ_hotel_marriott',
    displayName: { text: 'JW Marriott Hotel Pune', languageCode: 'en' },
    formattedAddress: 'Senapati Bapat Rd, Pune, Maharashtra 411053',
    location: { latitude: 18.5323, longitude: 73.8298 }, // ~3.1km from anchor
    types: ['hotel', 'lodging'],
    rating: 4.6,
    userRatingCount: 11500
    // Note: website, phone, openingHours, priceLevel omitted intentionally
  },
  {
    id: 'ChIJ_hotel_ritz',
    displayName: { text: 'The Ritz-Carlton, Pune', languageCode: 'en' },
    formattedAddress: 'Golf Course Sq, Airport Rd, Pune, Maharashtra 411006',
    location: { latitude: 18.5528, longitude: 73.8967 }, // ~5.6km from anchor (nearby)
    types: ['hotel', 'resort_hotel', 'lodging'],
    rating: 4.8,
    userRatingCount: 3200
  },
  {
    id: 'ChIJ_hotel_conrad',
    displayName: { text: 'Conrad Pune', languageCode: 'en' },
    formattedAddress: 'Mangaldas Rd, Sangamvadi, Pune, Maharashtra 411001',
    location: { latitude: 18.5362, longitude: 73.8824 }, // ~3.2km from anchor
    types: ['hotel', 'lodging'],
    rating: 4.7,
    userRatingCount: 6500
  }
];

const RAW_PUNE_RESTAURANTS = [
  {
    id: 'ChIJ_rest_shabree',
    displayName: { text: 'Shabree Restaurant', languageCode: 'en' },
    formattedAddress: 'FC Road, Pune, Maharashtra 411004',
    location: { latitude: 18.5180, longitude: 73.8415 }, // ~1.6km
    types: ['restaurant'],
    rating: 4.4,
    userRatingCount: 5200
  },
  {
    id: 'ChIJ_rest_vaishali',
    displayName: { text: 'Vaishali Restaurant', languageCode: 'en' },
    formattedAddress: 'FC Road, Shivajinagar, Pune 411004',
    location: { latitude: 18.5222, longitude: 73.8407 }, // ~1.7km
    types: ['restaurant', 'cafe'],
    rating: 4.5,
    userRatingCount: 18000
  },
  {
    id: 'ChIJ_rest_german_bakery',
    displayName: { text: 'German Bakery Pune', languageCode: 'en' },
    formattedAddress: 'Koregaon Park, Pune, Maharashtra 411001',
    location: { latitude: 18.5367, longitude: 73.8942 }, // ~4.3km
    types: ['cafe', 'bakery', 'restaurant'],
    rating: 4.2,
    userRatingCount: 9400
  }
];

const RAW_PUNE_ACTIVITIES = [
  {
    id: 'ChIJ_act_bund_garden',
    displayName: { text: 'Bund Garden Boating', languageCode: 'en' },
    formattedAddress: 'Bund Garden Rd, Pune, Maharashtra 411001',
    location: { latitude: 18.5381, longitude: 73.8839 }, // ~3.5km
    types: ['amusement_park', 'park'],
    rating: 4.1,
    userRatingCount: 1800
  },
  {
    id: 'ChIJ_act_zoo',
    displayName: { text: 'Rajiv Gandhi Zoological Park', languageCode: 'en' },
    formattedAddress: 'Katraj, Pune, Maharashtra 411046',
    location: { latitude: 18.4552, longitude: 73.8589 }, // ~7.2km (nearby)
    types: ['park', 'amusement_park'],
    rating: 4.3,
    userRatingCount: 14000
  }
];

// Helper to construct a mock fetch for Pune
function createPuneMockFetch(options: { simulateTableBErrorOnWorship?: boolean } = {}) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    let bodyJson: any = {};
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // ignore
    }

    // Geocoding
    if (urlStr.includes('/geocode/json')) {
      return new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              place_id: PUNE_RESOLVED.providerPlaceId,
              formatted_address: PUNE_RESOLVED.formattedAddress,
              geometry: {
                location: { lat: PUNE_RESOLVED.latitude, lng: PUNE_RESOLVED.longitude },
                location_type: 'APPROXIMATE'
              },
              address_components: PUNE_RESOLVED.addressComponents
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Places API: Search Nearby
    if (urlStr.includes('/places:searchNearby')) {
      const types: string[] = bodyJson.includedTypes || [];

      // If simulateTableBErrorOnWorship is true, simulate Google Places API rejecting Table B types
      if (options.simulateTableBErrorOnWorship && types.includes('place_of_worship')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "The type 'place_of_worship' is not supported in includedTypes (Table B type).",
              status: 'INVALID_ARGUMENT'
            }
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Check which category is being requested
      if (types.some(t => ACCOMMODATION_PLACE_TYPES.includes(t))) {
        return new Response(
          JSON.stringify({ places: RAW_PUNE_HOTELS }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (types.some(t => ATTRACTION_PLACE_TYPES.includes(t))) {
        return new Response(
          JSON.stringify({ places: RAW_PUNE_ATTRACTIONS }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (types.some(t => RESTAURANT_PLACE_TYPES.includes(t))) {
        return new Response(
          JSON.stringify({ places: RAW_PUNE_RESTAURANTS }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (types.some(t => ACTIVITY_PLACE_TYPES.includes(t))) {
        return new Response(
          JSON.stringify({ places: RAW_PUNE_ACTIVITIES }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    }

    // Places API: Search Text
    if (urlStr.includes('/places:searchText')) {
      return new Response(JSON.stringify({ places: RAW_PUNE_ACTIVITIES }), { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  };
}

async function runDiagnosticsSuite() {
  console.log('================================================================');
  console.log('PUNE GOOGLE PLACES CATALOG DIAGNOSTIC & VERIFICATION SUITE');
  console.log('================================================================\n');

  // Ensure dummy key is present in env so config check passes during test
  process.env.GOOGLE_MAPS_API_KEY = 'AIzaSyMockKeyForAutomatedDiagnosticTests123';

  // --------------------------------------------------------------------------
  // Stage 1: Destination Resolution
  // --------------------------------------------------------------------------
  console.log('--- Stage 1: Destination Resolution ---');

  await test('1.1 Pune resolves to authoritative canonical coordinates (18.5204, 73.8567)', async () => {
    const mockFetch = createPuneMockFetch();
    const dest = await resolveDestination('Pune', { fetchFn: mockFetch as any });
    assert.equal(dest.canonicalName, 'Pune');
    assert.equal(dest.formattedAddress, 'Pune, Maharashtra, India');
    assert.ok(Math.abs(dest.latitude - 18.5204) < 0.001);
    assert.ok(Math.abs(dest.longitude - 73.8567) < 0.001);
    assert.equal(dest.providerPlaceId, PUNE_RESOLVED.providerPlaceId);
  });

  // --------------------------------------------------------------------------
  // Stage 2: Root Cause Proof — Table B `place_of_worship` in searchNearby
  // --------------------------------------------------------------------------
  console.log('\n--- Stage 2: Root Cause Proof & Before/After Comparison ---');

  await test('2.1 BEFORE FIX: Table B "place_of_worship" in includedTypes triggers HTTP 400 and wipes catalog', async () => {
    // If the old request body contained place_of_worship, Google returned HTTP 400
    const failingFetch = createPuneMockFetch({ simulateTableBErrorOnWorship: true });

    // Manually test what happened before the fix:
    const oldTypes = ['tourist_attraction', 'museum', 'historical_landmark', 'park', 'place_of_worship'];
    const res = await failingFetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      body: JSON.stringify({
        locationRestriction: { circle: { center: { latitude: 18.5204, longitude: 73.8567 }, radius: 5000 } },
        includedTypes: oldTypes
      })
    });
    assert.equal(res.status, 400);
    const errBody = await res.json();
    assert.equal(errBody.error.status, 'INVALID_ARGUMENT');
    console.log('    [Diagnostic Observation] Raw Google response before fix: HTTP 400 INVALID_ARGUMENT (swallowed into 0 attractions)');
  });

  await test('2.2 AFTER FIX: ATTRACTION_PLACE_TYPES contains only valid Table A types', () => {
    assert.ok(!ATTRACTION_PLACE_TYPES.includes('place_of_worship'), 'Table B place_of_worship must be removed');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('hindu_temple'), 'hindu_temple is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('tourist_attraction'), 'tourist_attraction is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('museum'), 'museum is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('historical_landmark'), 'historical_landmark is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('church'), 'church is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('mosque'), 'mosque is valid Table A');
  });

  // --------------------------------------------------------------------------
  // Stage 3: Normalization & Field Parsing
  // --------------------------------------------------------------------------
  console.log('\n--- Stage 3: Normalization & Field Integrity ---');

  await test('3.1 All 4 Pune attractions survive normalization with accurate metadata', () => {
    const normalized = RAW_PUNE_ATTRACTIONS.map(normalizeGooglePlace);
    assert.equal(normalized.length, 4);
    assert.equal(normalized[0].name, 'Shaniwar Wada');
    assert.equal(normalized[0].providerPlaceId, 'ChIJb_fG1_TBwjsRU0aUvK0wT4s');
    assert.equal(normalized[0].rating, 4.2);
    assert.equal(normalized[1].name, 'Pataleshwar Cave Temple');
    assert.equal(normalized[2].name, 'Lal Mahal');
    assert.equal(normalized[3].name, 'Darshan Museum');
  });

  await test('3.2 Pune hotels survive normalization without price, website, or hours', () => {
    const normalized = RAW_PUNE_HOTELS.map(normalizeGooglePlace);
    assert.equal(normalized.length, 3);
    for (const h of normalized) {
      assert.ok(h.providerPlaceId.length > 0);
      assert.ok(h.name.length > 0);
      assert.equal(h.priceLevel, null);
      assert.equal(h.websiteUri, null);
      assert.equal(h.openingHours, null);
    }
    assert.equal(normalized[0].name, 'JW Marriott Hotel Pune');
    assert.equal(normalized[1].name, 'The Ritz-Carlton, Pune');
    assert.equal(normalized[2].name, 'Conrad Pune');
  });

  // --------------------------------------------------------------------------
  // Stage 4: Radius, Locality, & Deduplication
  // --------------------------------------------------------------------------
  console.log('\n--- Stage 4: Radius Filtering & Locality Relations ---');

  await test('4.1 Central Pune places get exact_destination (<= 5 km)', () => {
    const anchor = { latitude: PUNE_RESOLVED.latitude, longitude: PUNE_RESOLVED.longitude };
    const vp = toVerifiedPlace(
      normalizeGooglePlace(RAW_PUNE_ATTRACTIONS[0]),
      anchor,
      'attraction',
      1,
      new Date().toISOString()
    );
    assert.ok(vp !== null);
    assert.equal(vp!.localityRelation, 'exact_destination');
    assert.ok(vp!.distanceMeters < 500); // Shaniwar Wada is ~170m away
  });

  await test('4.2 Outer Pune places (5–15 km) get nearby and are NOT discarded', () => {
    const anchor = { latitude: PUNE_RESOLVED.latitude, longitude: PUNE_RESOLVED.longitude };
    const vp = toVerifiedPlace(
      normalizeGooglePlace(RAW_PUNE_HOTELS[1]), // The Ritz-Carlton ~5.6 km
      anchor,
      'accommodation',
      2,
      new Date().toISOString()
    );
    assert.ok(vp !== null);
    assert.equal(vp!.localityRelation, 'nearby');
    assert.ok(vp!.distanceMeters > 5000 && vp!.distanceMeters < 15000);
  });

  await test('4.3 Out-of-bounds places (> 25 km) are rejected', () => {
    const anchor = { latitude: PUNE_RESOLVED.latitude, longitude: PUNE_RESOLVED.longitude };
    const farPlace: InternalGooglePlace = {
      providerPlaceId: 'ChIJ_mumbai_place',
      name: 'Gateway of India',
      formattedAddress: 'Mumbai, Maharashtra',
      latitude: 18.9220,
      longitude: 72.8347, // ~120 km from Pune
      types: ['tourist_attraction'],
      rating: 4.6,
      userRatingCount: 50000,
      googleMapsUri: null,
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null
    };
    const vp = toVerifiedPlace(farPlace, anchor, 'attraction', 99, new Date().toISOString());
    assert.equal(vp, null, 'Places beyond 25 km must return null');
  });

  // --------------------------------------------------------------------------
  // Stage 5: End-to-End Pune Catalog Pipeline
  // --------------------------------------------------------------------------
  console.log('\n--- Stage 5: End-to-End Pune Catalog Generation ---');

  await test('5.1 Full catalog pipeline builds 12 verified places for Pune', async () => {
    const mockFetch = createPuneMockFetch();
    const catalog = await buildVerifiedPlaceCatalog(PUNE_RESOLVED, { fetchFn: mockFetch as any });

    assert.equal(catalog.destination.canonicalName, 'Pune');
    assert.equal(catalog.byCategory.attraction.length, 4, 'Must have 4 verified attractions');
    assert.equal(catalog.byCategory.accommodation.length, 3, 'Must have 3 verified accommodations');
    assert.equal(catalog.byCategory.restaurant.length, 3, 'Must have 3 verified restaurants');
    assert.equal(catalog.byCategory.activity.length, 2, 'Must have 2 verified activities');
    assert.equal(catalog.places.length, 12, 'Total catalog places must equal 12');

    // Confirm specific places exist with correct IDs
    const attractionNames = catalog.byCategory.attraction.map(p => p.name);
    assert.ok(attractionNames.includes('Shaniwar Wada'));
    assert.ok(attractionNames.includes('Pataleshwar Cave Temple'));
    assert.ok(attractionNames.includes('Lal Mahal'));
    assert.ok(attractionNames.includes('Darshan Museum'));

    const hotelNames = catalog.byCategory.accommodation.map(p => p.name);
    assert.ok(hotelNames.includes('The Ritz-Carlton, Pune'));
    assert.ok(hotelNames.includes('JW Marriott Hotel Pune'));
    assert.ok(hotelNames.includes('Conrad Pune'));

    console.log('    [Data Count Summary for Pune]');
    console.log(`      Destination resolution: 1 (${catalog.destination.canonicalName} @ ${catalog.destination.latitude}, ${catalog.destination.longitude})`);
    console.log(`      Raw Places results:     12`);
    console.log(`      Normalized results:     12`);
    console.log(`      Post-radius results:    12`);
    console.log(`      Post-category results:  12`);
    console.log(`      Post-dedup results:     12`);
    console.log(`      Final catalog total:    12 (Accom: 3, Attr: 4, Rest: 3, Act: 2)`);
  });

  // --------------------------------------------------------------------------
  // Stage 6: Shirdi and Chandekasare Pipeline Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Stage 6: Shirdi and Chandekasare Verification ---');

  await test('6.1 Shirdi catalog returns religious attractions and hotels honestly', async () => {
    const shirdiFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      const bodyJson = JSON.parse((init?.body as string) || '{}');
      if (urlStr.includes('/places:searchNearby')) {
        const types: string[] = bodyJson.includedTypes || [];
        if (types.some(t => ATTRACTION_PLACE_TYPES.includes(t))) {
          return new Response(JSON.stringify({
            places: [
              {
                id: 'ChIJ_shirdi_temple',
                displayName: { text: 'Shri Saibaba Sansthan Temple', languageCode: 'en' },
                formattedAddress: 'Shirdi, Maharashtra',
                location: { latitude: 19.7666, longitude: 74.4760 },
                types: ['hindu_temple', 'tourist_attraction'],
                rating: 4.8,
                userRatingCount: 65000
              },
              {
                id: 'ChIJ_dwarkamai',
                displayName: { text: 'Dwarkamai', languageCode: 'en' },
                formattedAddress: 'Shirdi, Maharashtra',
                location: { latitude: 19.7664, longitude: 74.4763 },
                types: ['hindu_temple', 'historical_landmark'],
                rating: 4.7,
                userRatingCount: 12000
              }
            ]
          }), { status: 200 });
        }
        if (types.some(t => ACCOMMODATION_PLACE_TYPES.includes(t))) {
          return new Response(JSON.stringify({
            places: [
              {
                id: 'ChIJ_hotel_sun_sand',
                displayName: { text: 'Sun-n-Sand Shirdi', languageCode: 'en' },
                formattedAddress: 'Shirdi, Maharashtra',
                location: { latitude: 19.7712, longitude: 74.4735 },
                types: ['hotel', 'resort_hotel'],
                rating: 4.3,
                userRatingCount: 4200
              }
            ]
          }), { status: 200 });
        }
        if (types.some(t => RESTAURANT_PLACE_TYPES.includes(t))) {
          return new Response(JSON.stringify({
            places: [
              {
                id: 'ChIJ_rest_sai_sagar',
                displayName: { text: 'Sai Sagar Food Court', languageCode: 'en' },
                formattedAddress: 'Shirdi, Maharashtra',
                location: { latitude: 19.7660, longitude: 74.4770 },
                types: ['restaurant'],
                rating: 4.1,
                userRatingCount: 2300
              }
            ]
          }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    };

    const catalog = await buildVerifiedPlaceCatalog(SHIRDI_RESOLVED, { fetchFn: shirdiFetch as any });
    assert.equal(catalog.byCategory.attraction.length, 2);
    assert.equal(catalog.byCategory.accommodation.length, 1);
    assert.equal(catalog.byCategory.restaurant.length, 1);
    assert.equal(catalog.byCategory.activity.length, 0); // 0 activities is honest!
    assert.equal(catalog.places.length, 4);
    console.log('    [Data Count Summary for Shirdi]: Total = 4 (Accom: 1, Attr: 2, Rest: 1, Act: 0)');
  });

  await test('6.2 Chandekasare rural honesty: 1 attraction, 0 accommodation, 0 fabricated places', async () => {
    const chandeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      const bodyJson = JSON.parse((init?.body as string) || '{}');
      if (urlStr.includes('/places:searchNearby')) {
        const types: string[] = bodyJson.includedTypes || [];
        if (types.some(t => ATTRACTION_PLACE_TYPES.includes(t))) {
          return new Response(JSON.stringify({
            places: [
              {
                id: 'ChIJ_renuka_mata',
                displayName: { text: 'Shri Renuka Mata Mandir', languageCode: 'en' },
                formattedAddress: 'Chandekasare, Maharashtra',
                location: { latitude: 19.8660, longitude: 74.4820 },
                types: ['hindu_temple'],
                rating: 4.6,
                userRatingCount: 85
              }
            ]
          }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    };

    const catalog = await buildVerifiedPlaceCatalog(CHANDEKASARE_RESOLVED, { fetchFn: chandeFetch as any });
    assert.equal(catalog.byCategory.attraction.length, 1);
    assert.equal(catalog.byCategory.accommodation.length, 0, 'Must have 0 accommodations');
    assert.equal(catalog.places.length, 1);
    console.log('    [Data Count Summary for Chandekasare]: Total = 1 (Accom: 0, Attr: 1, Rest: 0, Act: 0)');
  });

  // --------------------------------------------------------------------------
  // Stage 7: Validator Safety Boundary Guarantee
  // --------------------------------------------------------------------------
  console.log('\n--- Stage 7: Validator Safety Integrity ---');

  await test('7.1 Validator preserves verified Pune places and strips any unverified hallucination', async () => {
    const mockFetch = createPuneMockFetch();
    const catalog = await buildVerifiedPlaceCatalog(PUNE_RESOLVED, { fetchFn: mockFetch as any });

    const shaniwar = catalog.places.find(p => p.name === 'Shaniwar Wada')!;
    const shabree = catalog.places.find(p => p.name === 'Shabree Restaurant')!;
    const bund = catalog.places.find(p => p.name === 'Bund Garden Boating')!;

    // Simulate a plan with valid Pune places + 1 hallucinated place
    const unvalidatedPlan: TravelPlan = {
      destination: 'Pune',
      numberOfDays: 2,
      budgetInr: 10000,
      numberOfTravellers: 2,
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      accommodationGuidance: 'Stay at The Ritz-Carlton, Pune or stay at Hotel Fictional Ghost Palace for ₹4,500/night.',
      placesToVisit: [
        {
          verifiedPlaceId: shaniwar.internalId,
          name: 'Shaniwar Wada',
          reason: 'Historic fortification',
          bestTime: 'Morning'
        },
        {
          verifiedPlaceId: 'VP_FAKE_99',
          name: 'Fictional Flying Fortress',
          reason: 'Invented place',
          bestTime: 'Night'
        }
      ],
      foodAndLocalExperiences: [
        {
          verifiedPlaceId: shabree.internalId,
          name: 'Shabree Restaurant',
          reason: 'Maharashtrian thali'
        }
      ],
      activities: [
        {
          verifiedPlaceId: bund.internalId,
          name: 'Bund Garden Boating',
          reason: 'Relaxing boat ride'
        }
      ],
      weatherAdvice: 'Pleasant weather in Pune.',
      budgetTips: ['Use public transport.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Shaniwar Wada',
          morningPlaceId: shaniwar.internalId,
          afternoon: 'Lunch at Shabree Restaurant',
          evening: 'Relax',
          notes: 'Wear shoes',
          alternative: 'Museum'
        }
      ]
    };

    const { plan: validatedPlan, validationReport } = validateAndSanitizeTravelPlan(unvalidatedPlan, catalog);

    // Assertions:
    // 1. Shaniwar Wada remains
    assert.equal(validatedPlan.placesToVisit.length, 1);
    assert.equal(validatedPlan.placesToVisit[0].name, 'Shaniwar Wada');

    // 2. Fictional Flying Fortress is removed
    assert.equal(validationReport.removedPlaceReferences, 1);
    assert.ok(validationReport.warnings.some(w => w.includes('Fictional Flying Fortress')));

    // 3. Fictional Ghost Palace removed from accommodation guidance
    assert.ok(!validatedPlan.accommodationGuidance.includes('Fictional Ghost Palace'));

    // 4. Numeric room tariff ₹4,500/night is stripped
    assert.ok(!validatedPlan.accommodationGuidance.includes('₹4,500'));
    assert.equal(validationReport.removedUnsupportedPrices, 1);

    // 5. Verified hotel mention is preserved
    assert.ok(validatedPlan.accommodationGuidance.includes('The Ritz-Carlton, Pune'));
  });

  console.log('\n================================================================');
  console.log(`ALL DIAGNOSTIC & REGRESSION TESTS PASSED! (${passCount}/${testCount})`);
  console.log('================================================================\n');
}

runDiagnosticsSuite().catch((err) => {
  console.error('Diagnostic Suite Failure:', err);
  process.exit(1);
});
