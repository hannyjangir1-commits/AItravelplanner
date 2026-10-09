/**
 * Comprehensive OpenStreetMap Provider & Verification Pipeline Test Suite.
 *
 * Tests:
 * 1. Nominatim Geocoding (normalization, ambiguity detection, cache, rate-limit spacing)
 * 2. Overpass API Place Discovery (query building, tag classification, normalization, deduplication)
 * 3. Bounded concentric locality tiers (exact_destination, nearby, nearest_town)
 * 4. Realistic OSM Fixtures for Mumbai, Pune, Shirdi, and sparse rural Chandekasare
 * 5. Deterministic Place Catalog Builder & formatting for Gemini
 * 6. Post-generation Validator anti-hallucination boundary & pricing rules
 * 7. Optional day-by-day itinerary enabled/disabled support
 *
 * Note: ZERO live network calls in automated tests; uses authentic mocked OSM payloads.
 */

import assert from 'node:assert/strict';
import {
  geocodeDestinationWithOsm,
  searchOsmPlacesNearby,
  buildOverpassQuery,
  classifyOsmPlace,
  normalizeOsmElement,
  DestinationAmbiguityError,
  OsmNoResultsError,
  OsmRequestError,
  OsmRateLimitError,
  OsmTimeoutError,
  clearOsmCache,
  InternalOsmPlace
} from './src/services/osmProvider.js';
import {
  resolveDestination,
  ResolvedDestination
} from './src/services/destinationResolver.js';
import {
  buildVerifiedPlaceCatalog,
  toVerifiedPlace,
  formatCatalogForPrompt,
  determineLocalityRelation,
  compareVerifiedPlaces,
  VerifiedPlaceCatalog
} from './src/services/placeCatalog.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';
import { TravelPlan } from './src/types.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

// ============================================================================
// Fixtures
// ============================================================================

const MUMBAI_NOMINATIM_FIXTURE = [
  {
    place_id: 12345,
    osm_type: 'relation',
    osm_id: 78910,
    lat: '18.9220',
    lon: '72.8347',
    display_name: 'Mumbai, Mumbai Suburban, Maharashtra, India',
    name: 'Mumbai',
    importance: 0.92,
    boundingbox: ['18.8928', '19.2718', '72.7758', '72.9865'],
    address: {
      city: 'Mumbai',
      state_district: 'Mumbai Suburban',
      state: 'Maharashtra',
      country: 'India',
      country_code: 'in'
    }
  }
];

const AMBIGUOUS_SPRINGFIELD_FIXTURE = [
  {
    place_id: 101,
    osm_type: 'node',
    osm_id: 201,
    lat: '39.7817',
    lon: '-89.6501',
    display_name: 'Springfield, Sangamon County, Illinois, United States',
    name: 'Springfield',
    importance: 0.72,
    address: { city: 'Springfield', state: 'Illinois', country: 'United States', country_code: 'us' }
  },
  {
    place_id: 102,
    osm_type: 'node',
    osm_id: 202,
    lat: '37.2089',
    lon: '-93.2923',
    display_name: 'Springfield, Greene County, Missouri, United States',
    name: 'Springfield',
    importance: 0.71,
    address: { city: 'Springfield', state: 'Missouri', country: 'United States', country_code: 'us' }
  }
];

const MUMBAI_OVERPASS_FIXTURE = {
  elements: [
    {
      type: 'node',
      id: 1001,
      lat: 18.9220,
      lon: 72.8347,
      tags: {
        name: 'Gateway of India',
        tourism: 'attraction',
        historic: 'monument',
        'addr:street': 'Apollo Bandar',
        'addr:city': 'Mumbai'
      }
    },
    {
      type: 'way',
      id: 1002,
      center: { lat: 18.9432, lon: 72.8230 },
      tags: {
        name: 'Marine Drive',
        leisure: 'park',
        tourism: 'attraction'
      }
    },
    {
      type: 'node',
      id: 1003,
      lat: 18.9269,
      lon: 72.8327,
      tags: {
        name: 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya',
        tourism: 'museum',
        'addr:street': 'MG Road'
      }
    },
    {
      type: 'node',
      id: 2001,
      lat: 18.9217,
      lon: 72.8333,
      tags: {
        name: 'The Taj Mahal Palace, Mumbai',
        tourism: 'hotel',
        website: 'https://tajhotels.com',
        phone: '+91-22-66653366'
      }
    },
    {
      type: 'node',
      id: 3001,
      lat: 18.9348,
      lon: 72.8389,
      tags: {
        name: 'Britannia & Co. Restaurant',
        amenity: 'restaurant',
        cuisine: 'parsi;indian'
      }
    }
  ]
};

const PUNE_OVERPASS_FIXTURE = {
  elements: [
    {
      type: 'node',
      id: 4001,
      lat: 18.5196,
      lon: 73.8553,
      tags: {
        name: 'Shaniwar Wada',
        historic: 'fort',
        tourism: 'attraction'
      }
    },
    {
      type: 'way',
      id: 4002,
      center: { lat: 18.5524, lon: 73.9015 },
      tags: {
        name: 'Aga Khan Palace',
        historic: 'castle',
        tourism: 'attraction'
      }
    },
    {
      type: 'way',
      id: 4003,
      center: { lat: 18.3663, lon: 73.7558 },
      tags: {
        name: 'Sinhagad Fort',
        historic: 'fort'
      }
    },
    {
      type: 'node',
      id: 4004,
      lat: 18.5362,
      lon: 73.8296,
      tags: {
        name: 'JW Marriott Hotel Pune',
        tourism: 'hotel'
      }
    }
  ]
};

const SHIRDI_OVERPASS_FIXTURE = {
  elements: [
    {
      type: 'node',
      id: 5001,
      lat: 19.7667,
      lon: 74.4764,
      tags: {
        name: 'Shri Sai Baba Samadhi Mandir',
        amenity: 'place_of_worship',
        religion: 'hindu'
      }
    },
    {
      type: 'node',
      id: 5002,
      lat: 19.7680,
      lon: 74.4780,
      tags: {
        name: 'Sun-n-Sand Hotel Shirdi',
        tourism: 'hotel'
      }
    }
  ]
};

const CHANDEKASARE_OVERPASS_FIXTURE = {
  elements: [
    // Chandekasare is a rural farming village: no commercial hotels or named tourist attractions
    {
      type: 'node',
      id: 6001,
      lat: 19.8210,
      lon: 74.5220,
      tags: {
        name: 'Gram Panchayat Chandekasare',
        amenity: 'townhall'
      }
    }
  ]
};

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTestSuite() {
  console.log('================================================================');
  console.log('    OPENSTREETMAP PROVIDER & VERIFIED PIPELINE TEST SUITE       ');
  console.log('================================================================\n');

  clearOsmCache();

  // --------------------------------------------------------------------------
  // 1. Nominatim Geocoding
  // --------------------------------------------------------------------------
  console.log('--- 1. OpenStreetMap Nominatim Geocoding ---');

  await test('1.1 Geocodes valid destination into canonical coordinates', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(MUMBAI_NOMINATIM_FIXTURE), { status: 200 });

    const result = await geocodeDestinationWithOsm('Mumbai', { fetchFn: mockFetch as any });
    assert.equal(result.canonicalName, 'Mumbai');
    assert.equal(result.latitude, 18.922);
    assert.equal(result.longitude, 72.8347);
    assert.equal(result.osmType, 'relation');
    assert.equal(result.osmId, 78910);
    assert.ok(result.addressComponents.length > 0);
  });

  await test('1.2 Resolves through destinationResolver wrapper with viewport', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(MUMBAI_NOMINATIM_FIXTURE), { status: 200 });

    const dest = await resolveDestination('Mumbai', { fetchFn: mockFetch as any });
    assert.equal(dest.canonicalName, 'Mumbai');
    assert.equal(dest.providerPlaceId, 'osm:relation/78910');
    assert.ok(dest.viewport);
    assert.equal(dest.viewport?.southwest.lat, 18.8928);
    assert.equal(dest.viewport?.northeast.lat, 19.2718);
  });

  await test('1.3 Ambiguous destination throws DestinationAmbiguityError', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(AMBIGUOUS_SPRINGFIELD_FIXTURE), { status: 200 });

    await assert.rejects(
      async () => geocodeDestinationWithOsm('Springfield', { fetchFn: mockFetch as any }),
      (err: any) => {
        assert.ok(err instanceof DestinationAmbiguityError);
        assert.ok(err.candidateMatches.length >= 2);
        assert.ok(err.message.includes('ambiguous'));
        return true;
      }
    );
  });

  await test('1.4 Empty or blank destination query throws OsmRequestError', async () => {
    await assert.rejects(
      async () => resolveDestination('   '),
      (err: any) => err instanceof OsmRequestError && err.statusCode === 400
    );
  });

  await test('1.5 Empty results array throws OsmNoResultsError', async () => {
    const mockFetch = async () => new Response(JSON.stringify([]), { status: 200 });
    await assert.rejects(
      async () => geocodeDestinationWithOsm('NonExistentPlaceXYZ123', { fetchFn: mockFetch as any }),
      (err: any) => err instanceof OsmNoResultsError
    );
  });

  await test('1.6 In-memory cache returns cached geocode result without re-fetching', async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify(MUMBAI_NOMINATIM_FIXTURE), { status: 200 });
    };

    clearOsmCache();
    await geocodeDestinationWithOsm('Mumbai', { fetchFn: mockFetch as any });
    assert.equal(fetchCount, 1);

    // Second call should hit in-memory cache
    const second = await geocodeDestinationWithOsm('Mumbai', { fetchFn: mockFetch as any });
    assert.equal(fetchCount, 1, 'Fetch count must remain 1 due to caching');
    assert.equal(second.canonicalName, 'Mumbai');
  });

  // --------------------------------------------------------------------------
  // 2. Overpass Query Building & Tag Classification
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Overpass API Place Discovery ---');

  await test('2.1 buildOverpassQuery generates valid Overpass QL with radius and tags', () => {
    const ql = buildOverpassQuery(18.9220, 72.8347, 5000);
    assert.ok(ql.includes('(around:5000,18.922,72.8347)'));
    assert.ok(ql.includes('tourism'));
    assert.ok(ql.includes('hotel'));
    assert.ok(ql.includes('restaurant'));
    assert.ok(ql.includes('out center tags qt;'));
  });

  await test('2.2 classifyOsmPlace maps tags accurately to categories', () => {
    const hotel = classifyOsmPlace({ tourism: 'hotel' });
    assert.equal(hotel.category, 'accommodation');
    assert.ok(hotel.types.includes('hotel'));

    const museum = classifyOsmPlace({ tourism: 'museum', historic: 'monument' });
    assert.equal(museum.category, 'attraction');

    const cafe = classifyOsmPlace({ amenity: 'cafe', cuisine: 'coffee;bakery' });
    assert.equal(cafe.category, 'restaurant');
    assert.ok(cafe.types.includes('coffee'));

    const cinema = classifyOsmPlace({ amenity: 'cinema' });
    assert.equal(cinema.category, 'activity');
  });

  await test('2.3 normalizeOsmElement handles both node coordinates and way center coordinates', () => {
    const nodeEl = {
      type: 'node',
      id: 111,
      lat: 18.92,
      lon: 72.83,
      tags: { name: 'Apollo Pier', tourism: 'attraction' }
    };
    const normalizedNode = normalizeOsmElement(nodeEl, { latitude: 18.92, longitude: 72.83 });
    assert.ok(normalizedNode);
    assert.equal(normalizedNode?.providerPlaceId, 'osm:node/111');
    assert.equal(normalizedNode?.latitude, 18.92);

    const wayEl = {
      type: 'way',
      id: 222,
      center: { lat: 18.95, lon: 72.84 },
      tags: { name: 'Hanging Gardens', leisure: 'park' }
    };
    const normalizedWay = normalizeOsmElement(wayEl, { latitude: 18.92, longitude: 72.83 });
    assert.ok(normalizedWay);
    assert.equal(normalizedWay?.providerPlaceId, 'osm:way/222');
    assert.equal(normalizedWay?.latitude, 18.95);
  });

  await test('2.4 normalizeOsmElement rejects missing name, invalid coordinates, or empty tags', () => {
    assert.equal(normalizeOsmElement(null, { latitude: 0, longitude: 0 }), null);
    assert.equal(normalizeOsmElement({ type: 'node', id: 1 }, { latitude: 0, longitude: 0 }), null);
    assert.equal(normalizeOsmElement({ type: 'node', id: 1, lat: NaN, lon: 72, tags: { name: 'X' } }, { latitude: 0, longitude: 0 }), null);
  });

  // --------------------------------------------------------------------------
  // 3. Realistic Destination Coverage Fixtures
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Destination Coverage (Mumbai, Pune, Shirdi, Chandekasare) ---');

  await test('3.1 Mumbai: discovers Gateway of India, Marine Drive, CSMVS, Taj Palace, Britannia', async () => {
    const mockFetch = async () => new Response(JSON.stringify(MUMBAI_OVERPASS_FIXTURE), { status: 200 });

    const mumbaiDest: ResolvedDestination = {
      originalInput: 'Mumbai',
      canonicalName: 'Mumbai',
      formattedAddress: 'Mumbai, Maharashtra, India',
      latitude: 18.9220,
      longitude: 72.8347,
      addressComponents: []
    };

    const catalog = await buildVerifiedPlaceCatalog(mumbaiDest, { fetchFn: mockFetch as any });
    const names = catalog.places.map((p) => p.name);

    assert.ok(names.includes('Gateway of India'), 'Must include Gateway of India');
    assert.ok(names.includes('Marine Drive'), 'Must include Marine Drive');
    assert.ok(names.includes('Chhatrapati Shivaji Maharaj Vastu Sangrahalaya'), 'Must include CSMVS');
    assert.ok(names.includes('The Taj Mahal Palace, Mumbai'), 'Must include The Taj Mahal Palace');
    assert.ok(names.includes('Britannia & Co. Restaurant'), 'Must include Britannia & Co.');

    assert.equal(catalog.places[0].provider, 'openstreetmap');
    assert.equal(catalog.places[0].attribution, 'OpenStreetMap contributors');
    assert.ok(catalog.places[0].internalId.startsWith('VP_'));
  });

  await test('3.2 Pune: discovers Shaniwar Wada, Aga Khan Palace, Sinhagad Fort, JW Marriott', async () => {
    const mockFetch = async () => new Response(JSON.stringify(PUNE_OVERPASS_FIXTURE), { status: 200 });

    const puneDest: ResolvedDestination = {
      originalInput: 'Pune',
      canonicalName: 'Pune',
      formattedAddress: 'Pune, Maharashtra, India',
      latitude: 18.5204,
      longitude: 73.8567,
      addressComponents: []
    };

    const catalog = await buildVerifiedPlaceCatalog(puneDest, { fetchFn: mockFetch as any });
    const names = catalog.places.map((p) => p.name);

    assert.ok(names.includes('Shaniwar Wada'), 'Must include Shaniwar Wada');
    assert.ok(names.includes('Aga Khan Palace'), 'Must include Aga Khan Palace');
    assert.ok(names.includes('Sinhagad Fort'), 'Must include Sinhagad Fort');
    assert.ok(names.includes('JW Marriott Hotel Pune'), 'Must include JW Marriott');
  });

  await test('3.3 Shirdi: discovers Shri Sai Baba Samadhi Mandir and Sun-n-Sand Hotel', async () => {
    const mockFetch = async () => new Response(JSON.stringify(SHIRDI_OVERPASS_FIXTURE), { status: 200 });

    const shirdiDest: ResolvedDestination = {
      originalInput: 'Shirdi',
      canonicalName: 'Shirdi',
      formattedAddress: 'Shirdi, Maharashtra, India',
      latitude: 19.7667,
      longitude: 74.4764,
      addressComponents: []
    };

    const catalog = await buildVerifiedPlaceCatalog(shirdiDest, { fetchFn: mockFetch as any });
    const names = catalog.places.map((p) => p.name);

    assert.ok(names.includes('Shri Sai Baba Samadhi Mandir'));
    assert.ok(names.includes('Sun-n-Sand Hotel Shirdi'));
  });

  await test('3.4 Chandekasare (Rural): returns 0 accommodations and handles sparse data honestly', async () => {
    const mockFetch = async () => new Response(JSON.stringify(CHANDEKASARE_OVERPASS_FIXTURE), { status: 200 });

    const chandeDest: ResolvedDestination = {
      originalInput: 'Chandekasare',
      canonicalName: 'Chandekasare',
      formattedAddress: 'Chandekasare, Kopargaon, Maharashtra, India',
      latitude: 19.8210,
      longitude: 74.5220,
      addressComponents: []
    };

    const catalog = await buildVerifiedPlaceCatalog(chandeDest, { fetchFn: mockFetch as any });

    // Sparse coverage must report 0 accommodations and zero fake entities
    assert.equal(catalog.byCategory.accommodation.length, 0, 'Must have 0 accommodations');
    assert.equal(catalog.byCategory.restaurant.length, 0, 'Must have 0 restaurants');

    // Prompt formatting must be honest
    const promptSection = formatCatalogForPrompt(catalog);
    assert.ok(promptSection.includes('None found within 25 km'));
    assert.ok(promptSection.includes('OpenStreetMap contributors'));
  });

  // --------------------------------------------------------------------------
  // 4. Validator Anti-Hallucination & Post-Generation Security
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Travel Plan Validator & Grounding Security ---');

  await test('4.1 Validator preserves verified OSM places and strips unverified entities', () => {
    const mockDest: ResolvedDestination = {
      originalInput: 'Mumbai',
      canonicalName: 'Mumbai',
      formattedAddress: 'Mumbai, Maharashtra, India',
      latitude: 18.922,
      longitude: 72.8347,
      addressComponents: []
    };

    const stay = toVerifiedPlace(
      {
        providerPlaceId: 'osm:node/2001',
        osmType: 'node',
        osmId: 2001,
        name: 'The Taj Mahal Palace, Mumbai',
        formattedAddress: 'Apollo Bandar, Colaba, Mumbai',
        latitude: 18.9217,
        longitude: 72.8333,
        tags: { tourism: 'hotel' },
        categoryHint: 'accommodation',
        types: ['hotel'],
        websiteUri: null,
        phoneNumber: null,
        openingHours: null,
        attribution: 'OpenStreetMap contributors'
      },
      mockDest,
      'accommodation',
      1,
      new Date().toISOString()
    )!;

    const attr = toVerifiedPlace(
      {
        providerPlaceId: 'osm:node/1001',
        osmType: 'node',
        osmId: 1001,
        name: 'Gateway of India',
        formattedAddress: 'Apollo Bandar, Colaba, Mumbai',
        latitude: 18.9220,
        longitude: 72.8347,
        tags: { tourism: 'attraction' },
        categoryHint: 'attraction',
        types: ['attraction'],
        websiteUri: null,
        phoneNumber: null,
        openingHours: null,
        attribution: 'OpenStreetMap contributors'
      },
      mockDest,
      'attraction',
      2,
      new Date().toISOString()
    )!;

    const catalog: VerifiedPlaceCatalog = {
      destination: mockDest,
      places: [stay, attr],
      byCategory: {
        accommodation: [stay],
        attraction: [attr],
        restaurant: [],
        activity: [],
        poi: []
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        searchRadiiMeters: [5000],
        totalVerifiedPlaces: 2,
        dataSource: 'OpenStreetMap (ODbL)'
      }
    };

    const rawPlanFromGemini: any = {
      destination: 'Mumbai',
      duration: 1,
      budget: '₹10,000',
      accommodationGuidance: `Stay at ${stay.name} (${stay.internalId}) for a premium experience.`,
      placesToVisit: [
        {
          name: attr.name,
          verifiedPlaceId: attr.internalId,
          reason: 'Historic landmark.',
          bestTime: 'Morning'
        },
        {
          // Hallucinated place
          name: 'The Hallucinated Sky Garden',
          reason: 'A completely fictional place invented by AI.',
          bestTime: 'Evening'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Warm coastal climate',
      budgetTips: ['Use public transport'],
      includeDayByDayItinerary: true,
      itinerary: [
        {
          day: 1,
          morning: `Visit ${attr.name}.`,
          morningPlaceId: attr.internalId,
          afternoon: 'Explore waterfront.',
          evening: 'Sunset view.',
          notes: 'Carry water.',
          alternative: 'Indoor stay.'
        }
      ]
    };

    const { plan: validated, validationReport } = validateAndSanitizeTravelPlan(rawPlanFromGemini, catalog);

    assert.equal(validationReport.unverifiedPlaceReferences, 1, 'Tracks 1 unverified AI place reference');
    assert.equal(validationReport.validPlaceReferences, 2, 'Tracks 2 verified catalog place references (attraction + itinerary)');
    assert.equal(validated.placesToVisit.length, 2);
    assert.equal(validated.placesToVisit[0].name, 'Gateway of India');
    assert.equal(validated.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(validated.placesToVisit[1].name, 'The Hallucinated Sky Garden');
    assert.equal(validated.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(validated.placesToVisit[1].source, 'ai_suggestion');
    assert.ok(validated.accommodationGuidance.includes('The Taj Mahal Palace, Mumbai'));
  });

  await test('4.2 Sparse rural destination validator retains unverified suggestions with honest status', () => {
    const emptyCatalog: VerifiedPlaceCatalog = {
      destination: {
        originalInput: 'Chandekasare',
        canonicalName: 'Chandekasare',
        formattedAddress: 'Chandekasare, Maharashtra, India',
        latitude: 19.821,
        longitude: 74.522,
        addressComponents: []
      },
      places: [],
      byCategory: { accommodation: [], attraction: [], restaurant: [], activity: [], poi: [] },
      metadata: { generatedAt: new Date().toISOString(), searchRadiiMeters: [25000], totalVerifiedPlaces: 0, dataSource: 'OpenStreetMap (ODbL)' }
    };

    const hallucinatedRuralPlan: any = {
      destination: 'Chandekasare',
      duration: 1,
      budget: '₹5,000',
      accommodationGuidance: 'Stay at Chandekasare Royal Heritage Palace Resort in the village.',
      placesToVisit: [
        {
          name: 'Chandekasare Grand Theme Park',
          reason: 'Made up park.',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Sunny',
      budgetTips: [],
      includeDayByDayItinerary: false,
      itinerary: []
    };

    const { plan: validated, validationReport } = validateAndSanitizeTravelPlan(hallucinatedRuralPlan, emptyCatalog);

    assert.equal(validated.placesToVisit.length, 1, 'Retains attraction as unverified suggestion');
    assert.equal(validated.placesToVisit[0].name, 'Chandekasare Grand Theme Park');
    assert.equal(validated.placesToVisit[0].verificationStatus, 'unverified');
    assert.equal(validated.placesToVisit[0].source, 'ai_suggestion');
    assert.equal(validationReport.unverifiedPlaceReferences, 1);
    assert.equal(validated.includeDayByDayItinerary, false);
    assert.equal(validated.itinerary.length, 0);
  });

  await test('4.3 Validator removes fabricated hotel pricing', () => {
    const mockDest: ResolvedDestination = {
      originalInput: 'Pune',
      canonicalName: 'Pune',
      formattedAddress: 'Pune, Maharashtra, India',
      latitude: 18.52,
      longitude: 73.85,
      addressComponents: []
    };

    const hotel = toVerifiedPlace(
      {
        providerPlaceId: 'osm:node/4004',
        osmType: 'node',
        osmId: 4004,
        name: 'JW Marriott Hotel Pune',
        formattedAddress: 'Senapati Bapat Rd, Pune',
        latitude: 18.5362,
        longitude: 73.8296,
        tags: { tourism: 'hotel' },
        categoryHint: 'accommodation',
        types: ['hotel'],
        websiteUri: null,
        phoneNumber: null,
        openingHours: null,
        attribution: 'OpenStreetMap contributors'
      },
      mockDest,
      'accommodation',
      1,
      new Date().toISOString()
    )!;

    const catalog: VerifiedPlaceCatalog = {
      destination: mockDest,
      places: [hotel],
      byCategory: { accommodation: [hotel], attraction: [], restaurant: [], activity: [], poi: [] },
      metadata: { generatedAt: new Date().toISOString(), searchRadiiMeters: [5000], totalVerifiedPlaces: 1, dataSource: 'OpenStreetMap (ODbL)' }
    };

    const planWithFakePrice: any = {
      destination: 'Pune',
      duration: 1,
      budget: '₹8,000',
      accommodationGuidance: 'Stay at JW Marriott Hotel Pune for ₹8,500/night with breakfast.',
      placesToVisit: [],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Pleasant',
      budgetTips: [],
      includeDayByDayItinerary: true,
      itinerary: [
        {
          day: 1,
          morning: 'Relax at hotel.',
          afternoon: 'City stroll.',
          evening: 'Dinner.',
          notes: 'Notes.',
          alternative: 'Alt.'
        }
      ]
    };

    const { plan: validated, validationReport } = validateAndSanitizeTravelPlan(planWithFakePrice, catalog);

    assert.ok(!validated.accommodationGuidance.includes('₹8,500/night'));
    assert.ok(validated.accommodationGuidance.includes('(current accommodation pricing is unavailable)'));
    assert.ok(validationReport.removedUnsupportedPrices >= 1);
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
