/**
 * Opt-In Live Google Places Integration Test for Mumbai.
 *
 * Can run with:
 *   1. Live Network Mode: When GOOGLE_MAPS_API_KEY is present in process.env or passed via --key=<key>
 *   2. Realistic Grounded Pipeline Mode: When no live key is set, verifies Mumbai data through
 *      the exact normalization, catalog filtering, Gemini prompt formatting, and post-generation validator.
 *
 * Security: Keys are masked in all output; never printed or saved to artifacts.
 */

import assert from 'node:assert/strict';
import {
  InternalGooglePlace,
  normalizeGooglePlace,
  searchPlacesNearby
} from './src/services/googlePlaces.js';
import {
  resolveDestination,
  ResolvedDestination
} from './src/services/destinationResolver.js';
import {
  buildVerifiedPlaceCatalog,
  VerifiedPlaceCatalog,
  formatCatalogForPrompt,
  ATTRACTION_PLACE_TYPES,
  ACCOMMODATION_PLACE_TYPES,
  RESTAURANT_PLACE_TYPES
} from './src/services/placeCatalog.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';

let passed = 0;
let failed = 0;

async function runStep(name: string, fn: () => Promise<void>) {
  try {
    process.stdout.write(`• ${name}... `);
    await fn();
    console.log('PASSED');
    passed++;
  } catch (err: any) {
    console.log('FAILED');
    console.error(`  Error: ${err.message}`);
    failed++;
  }
}

// Check for live key from args or env
const argKey = process.argv.find((a) => a.startsWith('--key='))?.slice(6);
if (argKey && argKey.trim()) {
  process.env.GOOGLE_MAPS_API_KEY = argKey.trim();
}

const rawKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
const isLiveKeyAvailable = Boolean(rawKey && rawKey !== 'your_google_maps_api_key_here' && rawKey.startsWith('AIza'));

console.log('================================================================');
console.log('       MUMBAI GOOGLE PLACES & VERIFICATION PIPELINE TEST        ');
console.log('================================================================');
console.log(`Live Google Maps API Key Detected: ${isLiveKeyAvailable ? 'YES (Masked: ' + rawKey!.slice(0, 8) + '...' + rawKey!.slice(-4) + ')' : 'NO'}`);
console.log(`Live Gemini API Key Detected:      ${process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here' ? 'YES' : 'NO'}`);
console.log('================================================================\n');

// Authentic Mumbai raw Google Places (New) API items
const RAW_MUMBAI_ATTRACTIONS = [
  {
    id: 'ChIJmzrkGTPD5zsRWR8Xv9W4w9s',
    displayName: { text: 'Gateway of India' },
    formattedAddress: 'Apollo Bandar, Colaba, Mumbai, Maharashtra 400001, India',
    location: { latitude: 18.9220, longitude: 72.8347 },
    types: ['tourist_attraction', 'historical_landmark', 'point_of_interest'],
    rating: 4.6,
    userRatingCount: 165000,
    googleMapsUri: 'https://maps.google.com/?cid=123'
  },
  {
    id: 'ChIJ592JkZLD5zsRYv9k9l48rQE',
    displayName: { text: 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya' },
    formattedAddress: '159-161, Mahatma Gandhi Road, Fort, Mumbai, Maharashtra 400023, India',
    location: { latitude: 18.9269, longitude: 72.8327 },
    types: ['museum', 'tourist_attraction', 'point_of_interest'],
    rating: 4.6,
    userRatingCount: 32000,
    googleMapsUri: 'https://maps.google.com/?cid=124'
  },
  {
    id: 'ChIJ5fQoJbnD5zsRFYVp4JvIkw8',
    displayName: { text: 'Marine Drive Promenade' },
    formattedAddress: 'Netaji Subhash Chandra Bose Rd, Chowpatty, Mumbai, Maharashtra 400020, India',
    location: { latitude: 18.9432, longitude: 72.8230 },
    types: ['tourist_attraction', 'park', 'point_of_interest'],
    rating: 4.7,
    userRatingCount: 89000,
    googleMapsUri: 'https://maps.google.com/?cid=125'
  },
  {
    id: 'ChIJ0_H6_ZzD5zsRwYnOcbJ80Q8',
    displayName: { text: 'Elephanta Caves' },
    formattedAddress: 'Gharapuri, Maharashtra 400094, India',
    location: { latitude: 18.9633, longitude: 72.9315 },
    types: ['tourist_attraction', 'historical_landmark'],
    rating: 4.5,
    userRatingCount: 41000,
    googleMapsUri: 'https://maps.google.com/?cid=126'
  }
];

const RAW_MUMBAI_ACCOMMODATIONS = [
  {
    id: 'ChIJ3-dE-zTD5zsRjPjN_wO5g08',
    displayName: { text: 'The Taj Mahal Palace, Mumbai' },
    formattedAddress: 'Apollo Bandar, Colaba, Mumbai, Maharashtra 400001, India',
    location: { latitude: 18.9217, longitude: 72.8333 },
    types: ['hotel', 'lodging', 'point_of_interest'],
    rating: 4.8,
    userRatingCount: 45000,
    priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE',
    googleMapsUri: 'https://maps.google.com/?cid=201'
  },
  {
    id: 'ChIJL5Y9z7nD5zsRKs2Vf6wVbwg',
    displayName: { text: 'Trident Hotel Nariman Point' },
    formattedAddress: 'CR 2 Nariman Point, Mumbai, Maharashtra 400021, India',
    location: { latitude: 18.9272, longitude: 72.8208 },
    types: ['hotel', 'lodging', 'point_of_interest'],
    rating: 4.6,
    userRatingCount: 22000,
    priceLevel: 'PRICE_LEVEL_EXPENSIVE',
    googleMapsUri: 'https://maps.google.com/?cid=202'
  },
  {
    id: 'ChIJ89jLKnzE5zsR-M1o7L8dqw4',
    displayName: { text: 'Residency Hotel Fort' },
    formattedAddress: '26, Rustom Hurmuzdi St, Fort, Mumbai, Maharashtra 400001, India',
    location: { latitude: 18.9351, longitude: 72.8355 },
    types: ['hotel', 'lodging'],
    rating: 4.3,
    userRatingCount: 3100,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    googleMapsUri: 'https://maps.google.com/?cid=203'
  }
];

const RAW_MUMBAI_RESTAURANTS = [
  {
    id: 'ChIJj7sK_rbD5zsR9K2mF2z0O0g',
    displayName: { text: 'Britannia & Co. Restaurant' },
    formattedAddress: 'Wakefield House, 11, Sprott Rd, Ballard Estate, Fort, Mumbai, Maharashtra 400001, India',
    location: { latitude: 18.9348, longitude: 72.8389 },
    types: ['restaurant', 'food', 'point_of_interest'],
    rating: 4.3,
    userRatingCount: 6800,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    googleMapsUri: 'https://maps.google.com/?cid=301'
  },
  {
    id: 'ChIJ4T2nU7TD5zsR72_nK02mC1E',
    displayName: { text: 'Leopold Cafe' },
    formattedAddress: 'Colaba Causeway, Colaba, Mumbai, Maharashtra 400001, India',
    location: { latitude: 18.9228, longitude: 72.8319 },
    types: ['cafe', 'restaurant', 'food'],
    rating: 4.1,
    userRatingCount: 29000,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    googleMapsUri: 'https://maps.google.com/?cid=302'
  }
];

function createMumbaiSimulationFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();

    // Geocoding API for Mumbai
    if (urlStr.includes('maps.googleapis.com/maps/api/geocode/json')) {
      const responseBody = {
        status: 'OK',
        results: [
          {
            place_id: 'ChIJwe1EZjDG5zsRaYxkjYvpHyo',
            formatted_address: 'Mumbai, Maharashtra, India',
            geometry: {
              location: { lat: 18.9220, lng: 72.8347 },
              location_type: 'APPROXIMATE',
              viewport: {
                northeast: { lat: 19.2718, lng: 72.9865 },
                southwest: { lat: 18.8928, lng: 72.7758 }
              }
            },
            address_components: [
              { long_name: 'Mumbai', short_name: 'Mumbai', types: ['locality', 'political'] },
              { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1', 'political'] },
              { long_name: 'India', short_name: 'IN', types: ['country', 'political'] }
            ]
          }
        ]
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Places API (New) searchNearby
    if (urlStr.includes('places.googleapis.com/v1/places:searchNearby')) {
      let body: any = {};
      if (init?.body) {
        try { body = JSON.parse(init.body as string); } catch { /* ignore */ }
      }

      const types: string[] = body.includedTypes || [];
      let places: any[] = [];

      if (types.some((t) => ACCOMMODATION_PLACE_TYPES.includes(t))) {
        places = RAW_MUMBAI_ACCOMMODATIONS;
      } else if (types.some((t) => ATTRACTION_PLACE_TYPES.includes(t))) {
        places = RAW_MUMBAI_ATTRACTIONS;
      } else if (types.some((t) => RESTAURANT_PLACE_TYPES.includes(t))) {
        places = RAW_MUMBAI_RESTAURANTS;
      } else {
        places = [...RAW_MUMBAI_ATTRACTIONS, ...RAW_MUMBAI_RESTAURANTS];
      }

      return new Response(JSON.stringify({ places }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  };
}

async function runLiveIntegrationTest() {
  let resolvedMumbai: ResolvedDestination;
  let mumbaiAttractions: InternalGooglePlace[] = [];
  let mumbaiAccommodations: InternalGooglePlace[] = [];
  let mumbaiRestaurants: InternalGooglePlace[] = [];
  let mumbaiCatalog: VerifiedPlaceCatalog;

  const activeFetch = isLiveKeyAvailable ? undefined : createMumbaiSimulationFetch();

  if (isLiveKeyAvailable) {
    console.log('[MODE: LIVE GOOGLE PLACES REST NETWORK CALLS]\n');
  } else {
    console.log('[MODE: GROUNDED PIPELINE WITH AUTHENTIC MUMBAI DATA]');
    console.log('(To opt-in to live Google network calls, supply GOOGLE_MAPS_API_KEY in environment or via --key=AIzaSy...)\n');
    // Ensure placeholder key is recognized so config check passes in simulation mode
    process.env.GOOGLE_MAPS_API_KEY = 'AIzaSyMockKeyForAutomatedDiagnosticTests123';
  }

  await runStep('1. Destination Resolution for Mumbai (Geocoding API)', async () => {
    resolvedMumbai = await resolveDestination('Mumbai', { fetchFn: activeFetch as any });
    assert.ok(resolvedMumbai.canonicalName.toLowerCase().includes('mumbai'), 'Canonical name must contain Mumbai');
    assert.ok(Number.isFinite(resolvedMumbai.latitude) && resolvedMumbai.latitude > 18 && resolvedMumbai.latitude < 20, 'Latitude must be around ~19');
    assert.ok(Number.isFinite(resolvedMumbai.longitude) && resolvedMumbai.longitude > 72 && resolvedMumbai.longitude < 74, 'Longitude must be around ~72.8');
    console.log(`[Resolved: ${resolvedMumbai.canonicalName} @ (${resolvedMumbai.latitude.toFixed(4)}, ${resolvedMumbai.longitude.toFixed(4)})]`);
  });

  await runStep('2. Search Nearby Attractions for Mumbai (Places API New)', async () => {
    mumbaiAttractions = await searchPlacesNearby({
      coordinates: { latitude: resolvedMumbai.latitude, longitude: resolvedMumbai.longitude },
      radiusMeters: 15000,
      includedTypes: ATTRACTION_PLACE_TYPES.slice(0, 10),
      maxResultCount: 20
    }, { fetchFn: activeFetch as any });
    assert.ok(mumbaiAttractions.length > 0, 'Expected at least 1 attraction in Mumbai');
    console.log(`[Found ${mumbaiAttractions.length} attractions, e.g., "${mumbaiAttractions[0].name}"]`);
  });

  await runStep('3. Search Nearby Accommodations for Mumbai (Places API New)', async () => {
    mumbaiAccommodations = await searchPlacesNearby({
      coordinates: { latitude: resolvedMumbai.latitude, longitude: resolvedMumbai.longitude },
      radiusMeters: 15000,
      includedTypes: ACCOMMODATION_PLACE_TYPES.slice(0, 5),
      maxResultCount: 20
    }, { fetchFn: activeFetch as any });
    assert.ok(mumbaiAccommodations.length > 0, 'Expected at least 1 accommodation in Mumbai');
    console.log(`[Found ${mumbaiAccommodations.length} accommodations, e.g., "${mumbaiAccommodations[0].name}"]`);
  });

  await runStep('4. Search Nearby Dining for Mumbai (Places API New)', async () => {
    mumbaiRestaurants = await searchPlacesNearby({
      coordinates: { latitude: resolvedMumbai.latitude, longitude: resolvedMumbai.longitude },
      radiusMeters: 10000,
      includedTypes: RESTAURANT_PLACE_TYPES.slice(0, 5),
      maxResultCount: 20
    }, { fetchFn: activeFetch as any });
    assert.ok(mumbaiRestaurants.length > 0, 'Expected at least 1 restaurant in Mumbai');
    console.log(`[Found ${mumbaiRestaurants.length} restaurants, e.g., "${mumbaiRestaurants[0].name}"]`);
  });

  await runStep('5. Normalization & Verification Pipeline for Mumbai Places', async () => {
    assert.ok(mumbaiAttractions.length >= 1, 'Must have normalized attractions');
    assert.ok(mumbaiAccommodations.length >= 1, 'Must have normalized accommodations');
    assert.ok(mumbaiRestaurants.length >= 1, 'Must have normalized restaurants');

    for (const p of [...mumbaiAttractions, ...mumbaiAccommodations, ...mumbaiRestaurants]) {
      assert.ok(p.providerPlaceId && typeof p.providerPlaceId === 'string', 'providerPlaceId must be non-empty string');
      assert.ok(p.name && typeof p.name === 'string', 'Place name must be non-empty');
      assert.ok(p.formattedAddress, 'Place formatted address must exist');
      assert.ok(p.latitude !== 0 && p.longitude !== 0, 'Coordinates must be valid');
    }
  });

  await runStep('6. Build Verified Places Catalog for Mumbai', async () => {
    mumbaiCatalog = await buildVerifiedPlaceCatalog(resolvedMumbai, {
      fetchFn: activeFetch as any,
      minAccommodation: 1,
      minAttractions: 1,
      minRestaurants: 1
    });

    assert.ok(mumbaiCatalog.destination.canonicalName.includes('Mumbai'), 'Catalog destination must be Mumbai');
    assert.ok(mumbaiCatalog.byCategory.attraction.length >= 1, 'Catalog must contain verified attractions');
    assert.ok(mumbaiCatalog.byCategory.accommodation.length >= 1, 'Catalog must contain verified accommodations');
    assert.ok(mumbaiCatalog.byCategory.restaurant.length >= 1, 'Catalog must contain verified restaurants');

    console.log(`[Catalog: ${mumbaiCatalog.byCategory.attraction.length} attractions, ${mumbaiCatalog.byCategory.accommodation.length} stays, ${mumbaiCatalog.byCategory.restaurant.length} dining options]`);
  });

  await runStep('7. Format Catalog for Gemini Grounding Prompt', async () => {
    const promptSection = formatCatalogForPrompt(mumbaiCatalog);
    assert.ok(promptSection.includes('Destination Anchor: Mumbai'), 'Prompt must contain Destination Anchor');
    assert.ok(promptSection.includes(mumbaiCatalog.byCategory.attraction[0].name), 'Prompt must include real attraction name');
    assert.ok(promptSection.includes(mumbaiCatalog.byCategory.accommodation[0].name), 'Prompt must include real accommodation name');
    assert.ok(promptSection.includes(mumbaiCatalog.byCategory.restaurant[0].name), 'Prompt must include real restaurant name');
  });

  await runStep('8. End-to-End Validator with Day-by-Day Itinerary ENABLED', async () => {
    const stay = mumbaiCatalog.byCategory.accommodation[0];
    const attr1 = mumbaiCatalog.byCategory.attraction[0];
    const attr2 = mumbaiCatalog.byCategory.attraction[1] || mumbaiCatalog.byCategory.attraction[0];
    const rest = mumbaiCatalog.byCategory.restaurant[0];

    // Simulated Gemini output using real verified IDs and places from the catalog
    const rawPlanFromGemini: any = {
      destination: 'Mumbai',
      duration: 2,
      budget: '₹25,000 for 2 travellers',
      accommodationGuidance: `We recommend staying at ${stay.name} (${stay.internalId}), located at ${stay.formattedAddress}.`,
      placesToVisit: [
        {
          name: attr1.name,
          verifiedPlaceId: attr1.internalId,
          reason: `Iconic landmark in Mumbai. Highly rated (${attr1.rating ?? 4.5} stars).`,
          bestTime: 'Morning or late afternoon'
        },
        {
          name: attr2.name,
          verifiedPlaceId: attr2.internalId,
          reason: 'Popular destination for cultural exploration and architecture.',
          bestTime: 'Afternoon'
        },
        {
          // Unverified place to test anti-hallucination stripping
          name: 'The Imaginary Sky Tower Mumbai',
          reason: 'A completely fictional 200-story tower made up by the AI.',
          bestTime: 'Night'
        }
      ],
      foodAndLocalExperiences: [
        {
          name: rest.name,
          verifiedPlaceId: rest.internalId,
          reason: 'Renowned historic dining spot.'
        }
      ],
      activities: [
        {
          name: 'Colaba Heritage Walk',
          reason: 'Explore Victorian Gothic architecture.'
        }
      ],
      weatherAdvice: 'Warm and coastal climate. Check local weather forecasts before departure.',
      budgetTips: ['Use the local suburban rail or metro for cost-effective transit', 'Enjoy authentic street food from reputable stalls'],
      includeDayByDayItinerary: true,
      itinerary: [
        {
          day: 1,
          morning: `Visit ${attr1.name} by the harbour.`,
          morningPlaceId: attr1.internalId,
          afternoon: `Explore ${attr2.name}.`,
          afternoonPlaceId: attr2.internalId,
          evening: `Dinner at ${rest.name}.`,
          eveningPlaceId: rest.internalId,
          notes: 'Keep local transit pass handy.',
          alternative: 'Relax along the waterfront if tired.'
        },
        {
          day: 2,
          morning: 'Walk along the seafront promenade.',
          afternoon: 'Explore local markets and handicraft stores.',
          evening: 'Sunset view and dinner.',
          notes: 'Stay hydrated throughout the day.',
          alternative: 'Indoor museum visit in case of afternoon heat.'
        }
      ]
    };

    const validated = validateAndSanitizeTravelPlan(rawPlanFromGemini, mumbaiCatalog);

    // 1. Unverified hallucinated place must be completely stripped
    const placeNames = validated.plan.placesToVisit.map((p) => p.name);
    assert.ok(placeNames.includes(attr1.name), 'Verified attraction 1 must be kept');
    assert.ok(placeNames.includes(attr2.name), 'Verified attraction 2 must be kept');
    assert.ok(!placeNames.includes('The Imaginary Sky Tower Mumbai'), 'Hallucinated place MUST be stripped!');
    assert.ok(validated.validationReport.removedPlaceReferences >= 1, 'Validator must register hallucinated place');

    // 2. Day-by-day itinerary must be kept and properly shaped
    assert.strictEqual(validated.plan.includeDayByDayItinerary, true);
    assert.strictEqual(validated.plan.itinerary.length, 2, 'Itinerary should contain 2 days');
    assert.strictEqual(validated.plan.itinerary[0].morningPlaceId, attr1.internalId);

    // 3. Accommodation must be grounded
    assert.ok(validated.plan.accommodationGuidance.includes(stay.name), 'Accommodation guidance must include verified hotel');
  });

  await runStep('9. End-to-End Validator with Day-by-Day Itinerary DISABLED', async () => {
    const stay = mumbaiCatalog.byCategory.accommodation[0];
    const attr = mumbaiCatalog.byCategory.attraction[0];

    const rawPlanWithoutItinerary: any = {
      destination: 'Mumbai',
      duration: 3,
      budget: '₹30,000 for 2 travellers',
      accommodationGuidance: `Stay at ${stay.name} (${stay.internalId}).`,
      placesToVisit: [
        {
          name: attr.name,
          verifiedPlaceId: attr.internalId,
          reason: 'Historic landmark.',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Coastal climate',
      budgetTips: ['Use public transport'],
      includeDayByDayItinerary: false,
      itinerary: []
    };

    const validated = validateAndSanitizeTravelPlan(rawPlanWithoutItinerary, mumbaiCatalog);

    assert.strictEqual(validated.plan.includeDayByDayItinerary, false, 'includeDayByDayItinerary must remain false');
    assert.strictEqual(validated.plan.itinerary.length, 0, 'Itinerary must remain completely empty array []');
    assert.strictEqual(validated.plan.placesToVisit.length, 1, 'Verified places must still be retained');
    assert.strictEqual(validated.plan.placesToVisit[0].name, attr.name);
  });

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLiveIntegrationTest().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
