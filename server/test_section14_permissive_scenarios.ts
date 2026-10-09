import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config();
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-mock-api-key';

import {
  generateTravelPlanService,
  modifyTravelPlanService,
  cleanAndParseJSON
} from './src/aiService.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';
import { resolveDestination } from './src/services/destinationResolver.js';
import { OsmNoResultsError, DestinationAmbiguityError } from './src/services/osmProvider.js';
import { buildVerifiedPlaceCatalog } from './src/services/placeCatalog.js';
import type {
  VerifiedPlaceCatalog,
  VerifiedPlace,
  TravelPlan,
  GeneratePlanRequest,
  ModifyPlanRequest,
  ResolvedDestination
} from './src/types.js';

// --- Fixtures & Helpers ---

const MOCK_DEST_MUMBAI: ResolvedDestination = {
  originalInput: 'Mumbai',
  canonicalName: 'Mumbai',
  formattedAddress: 'Mumbai, Maharashtra, India',
  latitude: 18.922,
  longitude: 72.8347,
  addressComponents: []
};

const MOCK_DEST_RURAL: ResolvedDestination = {
  originalInput: 'Chandekasare',
  canonicalName: 'Chandekasare',
  formattedAddress: 'Chandekasare, Ahmednagar, Maharashtra, India',
  latitude: 19.8654,
  longitude: 74.4812,
  addressComponents: []
};

const MOCK_GATEWAY: VerifiedPlace = {
  internalId: 'VP_01',
  provider: 'osm',
  providerPlaceId: 'osm:node/101',
  name: 'Gateway of India',
  primaryCategory: 'attraction',
  types: ['monument'],
  formattedAddress: 'Apollo Bandar, Colaba, Mumbai',
  location: { latitude: 18.922, longitude: 72.8347 },
  distanceMeters: 50,
  localityRelation: 'exact_destination',
  verifiedAt: new Date().toISOString()
};

const MOCK_TAJ_HOTEL: VerifiedPlace = {
  internalId: 'VP_02',
  provider: 'osm',
  providerPlaceId: 'osm:way/202',
  name: 'The Taj Mahal Palace, Mumbai',
  primaryCategory: 'accommodation',
  types: ['hotel'],
  formattedAddress: 'Colaba, Mumbai',
  location: { latitude: 18.9217, longitude: 72.833 },
  distanceMeters: 120,
  localityRelation: 'exact_destination',
  verifiedAt: new Date().toISOString()
};

const MOCK_LEOPOLD: VerifiedPlace = {
  internalId: 'VP_03',
  provider: 'osm',
  providerPlaceId: 'osm:node/303',
  name: 'Leopold Cafe',
  primaryCategory: 'restaurant',
  types: ['cafe'],
  formattedAddress: 'Colaba Causeway, Mumbai',
  location: { latitude: 18.9225, longitude: 72.8315 },
  distanceMeters: 300,
  localityRelation: 'exact_destination',
  verifiedAt: new Date().toISOString()
};

const FULL_MUMBAI_CATALOG: VerifiedPlaceCatalog = {
  destination: MOCK_DEST_MUMBAI,
  places: [MOCK_GATEWAY, MOCK_TAJ_HOTEL, MOCK_LEOPOLD],
  byCategory: {
    accommodation: [MOCK_TAJ_HOTEL],
    attraction: [MOCK_GATEWAY],
    restaurant: [MOCK_LEOPOLD],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    searchRadiiMeters: [5000],
    totalVerifiedPlaces: 3,
    dataSource: 'OpenStreetMap (ODbL)'
  }
};

const SPARSE_RURAL_CATALOG: VerifiedPlaceCatalog = {
  destination: MOCK_DEST_RURAL,
  places: [
    {
      internalId: 'VP_01',
      provider: 'osm',
      providerPlaceId: 'osm:node/991',
      name: 'Chandekasare Ancient Temple',
      primaryCategory: 'attraction',
      types: ['temple'],
      formattedAddress: 'Chandekasare Village',
      location: { latitude: 19.8654, longitude: 74.4812 },
      distanceMeters: 40,
      localityRelation: 'exact_destination',
      verifiedAt: new Date().toISOString()
    }
  ],
  byCategory: {
    accommodation: [],
    attraction: [
      {
        internalId: 'VP_01',
        provider: 'osm',
        providerPlaceId: 'osm:node/991',
        name: 'Chandekasare Ancient Temple',
        primaryCategory: 'attraction',
        types: ['temple'],
        formattedAddress: 'Chandekasare Village',
        location: { latitude: 19.8654, longitude: 74.4812 },
        distanceMeters: 40,
        localityRelation: 'exact_destination',
        verifiedAt: new Date().toISOString()
      }
    ],
    restaurant: [],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    searchRadiiMeters: [5000, 15000, 25000],
    totalVerifiedPlaces: 1,
    dataSource: 'OpenStreetMap (ODbL)'
  }
};

const EMPTY_CATALOG: VerifiedPlaceCatalog = {
  destination: MOCK_DEST_RURAL,
  places: [],
  byCategory: {
    accommodation: [],
    attraction: [],
    restaurant: [],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    searchRadiiMeters: [5000, 15000, 25000],
    totalVerifiedPlaces: 0,
    dataSource: 'OpenStreetMap (ODbL)'
  }
};

function createMockFetch(jsonContent: string, status = 200, delayMs = 0): typeof fetch {
  return async (url: any) => {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    if (status !== 200) {
      return new Response(jsonContent, { status });
    }
    const urlStr = String(url);
    if (urlStr.includes('generateContent')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: jsonContent }]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(jsonContent, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

let passed = 0;
let total = 0;

async function runScenario(title: string, fn: () => Promise<void> | void) {
  total++;
  process.stdout.write(`Scenario ${total}: ${title}... `);
  try {
    await fn();
    passed++;
    console.log('PASSED');
  } catch (err: any) {
    console.log('FAILED');
    console.error(err);
  }
}

async function runSection14Suite() {
  console.log('================================================================');
  console.log('TRAVELGENIE SECTION 14: PERMISSIVE AI GENERATION SCENARIOS');
  console.log('================================================================\n');

  // TEST 1 — NORMAL DESTINATION WITH MANY CATALOG PLACES
  await runScenario('TEST 1 - Normal Destination with Many Catalog Places', async () => {
    const aiResponse = JSON.stringify({
      accommodationGuidance: 'Stay at The Taj Mahal Palace, Mumbai.',
      placesToVisit: [
        {
          verifiedPlaceId: 'VP_01',
          name: 'Gateway of India',
          reason: 'Historic waterfront monument.',
          bestTime: 'Early morning'
        }
      ],
      foodAndLocalExperiences: [
        {
          verifiedPlaceId: 'VP_03',
          name: 'Leopold Cafe',
          reason: 'Historic cafe nearby.'
        }
      ],
      activities: [],
      weatherAdvice: 'Coastal climate with sea breeze.',
      budgetTips: ['Use local suburban trains.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Gateway of India',
          morningPlaceId: 'VP_01',
          afternoon: 'Lunch at Leopold Cafe',
          afternoonPlaceId: 'VP_03',
          evening: 'Colaba promenade',
          notes: '',
          alternative: ''
        }
      ]
    });

    const req: GeneratePlanRequest = {
      destination: 'Mumbai',
      numberOfDays: 1,
      budgetInr: 15000,
      numberOfTravellers: 1,
      interests: ['History', 'Food'],
      includeDayByDayItinerary: true
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: FULL_MUMBAI_CATALOG,
      fetchFn: createMockFetch(aiResponse)
    });

    assert.equal(result.isDemo, false);
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(result.plan.placesToVisit[0].source, 'catalog');
    assert.equal(result.plan.foodAndLocalExperiences[0].verificationStatus, 'verified');
    assert.equal(result.plan.itinerary.length, 1);
  });

  // TEST 2 — SMALL DESTINATION WITH FEW CATALOG PLACES
  await runScenario('TEST 2 - Small Destination with Few Catalog Places (Permissive AI Suggestions)', async () => {
    const aiResponse = JSON.stringify({
      accommodationGuidance: 'Homestays or guest houses in nearby towns are recommended.',
      placesToVisit: [
        {
          verifiedPlaceId: 'VP_01',
          name: 'Chandekasare Ancient Temple',
          reason: 'Sacred local heritage temple.',
          bestTime: 'Morning'
        },
        {
          // AI suggestion without catalog ID
          name: 'Godavari Riverbank Walk',
          reason: 'Scenic peaceful walk along the nearby riverbank known to travelers.',
          bestTime: 'Late afternoon'
        }
      ],
      foodAndLocalExperiences: [
        {
          name: 'Local Rural Dhaba Experience',
          reason: 'Traditional Maharashtrian bhakri and pitla along the highway.'
        }
      ],
      activities: [],
      weatherAdvice: 'Warm and dry rural weather.',
      budgetTips: ['Carry sufficient cash as digital payments may have spotty connectivity.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Chandekasare Ancient Temple',
          morningPlaceId: 'VP_01',
          afternoon: 'Enjoy lunch at a local dhaba',
          evening: 'Sunset by Godavari Riverbank Walk',
          notes: 'Dress modestly for temple',
          alternative: 'Relax at village square'
        }
      ]
    });

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 5000,
      numberOfTravellers: 2,
      includeDayByDayItinerary: true
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: SPARSE_RURAL_CATALOG,
      fetchFn: createMockFetch(aiResponse)
    });

    assert.equal(result.plan.placesToVisit.length, 2);
    // Verified catalog place
    assert.equal(result.plan.placesToVisit[0].name, 'Chandekasare Ancient Temple');
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(result.plan.placesToVisit[0].source, 'catalog');

    // AI-suggested unverified place survives validation
    assert.equal(result.plan.placesToVisit[1].name, 'Godavari Riverbank Walk');
    assert.equal(result.plan.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(result.plan.placesToVisit[1].source, 'ai_suggestion');
    assert.equal(result.plan.placesToVisit[1].verifiedPlaceId, null);

    // AI-suggested food survives validation
    assert.equal(result.plan.foodAndLocalExperiences.length, 1);
    assert.equal(result.plan.foodAndLocalExperiences[0].verificationStatus, 'unverified');
    assert.equal(result.plan.foodAndLocalExperiences[0].source, 'ai_suggestion');
  });

  // TEST 3 — EMPTY CATALOG
  await runScenario('TEST 3 - Empty Catalog (Destination Resolved, 0 Places Discovered)', async () => {
    const aiResponse = JSON.stringify({
      accommodationGuidance: 'Check lodging options in nearest junction or rural homestays.',
      placesToVisit: [
        {
          name: 'Village Central Chawdi',
          reason: 'Historic community gathering place.',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Pleasant mornings, warm afternoons.',
      budgetTips: ['Travel by local state transport buses.'],
      itinerary: []
    });

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: EMPTY_CATALOG,
      fetchFn: createMockFetch(aiResponse)
    });

    // Plan generated successfully despite 0 verified places
    assert.equal(result.isDemo, false);
    assert.equal(result.plan.placesToVisit.length, 1);
    assert.equal(result.plan.placesToVisit[0].name, 'Village Central Chawdi');
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'unverified');
    assert.equal(result.plan.placesToVisit[0].source, 'ai_suggestion');
    assert.equal(result.plan.placesToVisit[0].verifiedPlaceId, null);
  });

  // TEST 4 — MISSING RESTAURANT DATA
  await runScenario('TEST 4 - Missing Restaurant Data in Catalog (AI Suggestions Permitted)', () => {
    const catalogWithoutRestaurants: VerifiedPlaceCatalog = {
      ...FULL_MUMBAI_CATALOG,
      places: [MOCK_GATEWAY, MOCK_TAJ_HOTEL],
      byCategory: {
        accommodation: [MOCK_TAJ_HOTEL],
        attraction: [MOCK_GATEWAY],
        restaurant: [],
        activity: [],
        poi: []
      }
    };

    const rawPlan: TravelPlan = {
      accommodationGuidance: 'Stay at The Taj Mahal Palace, Mumbai.',
      placesToVisit: [{ verifiedPlaceId: 'VP_01', name: 'Gateway of India', reason: 'Monument', bestTime: 'Morning' }],
      foodAndLocalExperiences: [
        {
          name: 'Street Food at Chowpatty Beach',
          reason: 'Bhelpuri and Pav Bhaji along Marine Drive.'
        }
      ],
      activities: [],
      weatherAdvice: 'Warm',
      budgetTips: ['Carry cash'],
      itinerary: [],
      includeDayByDayItinerary: false
    };

    const { plan: sanitized } = validateAndSanitizeTravelPlan(rawPlan, catalogWithoutRestaurants);
    assert.equal(sanitized.foodAndLocalExperiences.length, 1);
    assert.equal(sanitized.foodAndLocalExperiences[0].name, 'Street Food at Chowpatty Beach');
    assert.equal(sanitized.foodAndLocalExperiences[0].verificationStatus, 'unverified');
    assert.equal(sanitized.foodAndLocalExperiences[0].source, 'ai_suggestion');
  });

  // TEST 5 — MISSING ACCOMMODATION DATA
  await runScenario('TEST 5 - Missing Accommodation Data (Honest Guidance & Price Sanitization)', () => {
    const rawPlan: TravelPlan = {
      accommodationGuidance: 'Stay at Hillside Rural Resort for ₹4,500/night.',
      placesToVisit: [{ verifiedPlaceId: 'VP_01', name: 'Chandekasare Ancient Temple', reason: 'Temple', bestTime: 'Morning' }],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Clear',
      budgetTips: ['Rooms cost ₹4,500 per night so plan budget accordingly.'],
      itinerary: [],
      includeDayByDayItinerary: false
    };

    const { plan: sanitized } = validateAndSanitizeTravelPlan(rawPlan, SPARSE_RURAL_CATALOG);
    // Preserves guidance but strips unsupported price
    assert.ok(!sanitized.accommodationGuidance.includes('₹4,500/night'));
    assert.ok(sanitized.accommodationGuidance.includes('(current accommodation pricing is unavailable)'));
    // Sanitizes unsupported room price claim from budget tips
    assert.ok(!sanitized.budgetTips[0].includes('₹4,500'));
    assert.ok(sanitized.budgetTips[0].includes('Confirm current room rates directly'));
  });

  // TEST 6 — UNKNOWN CATALOG ID
  await runScenario('TEST 6 - Unknown / Fabricated Catalog ID (Normalizes to Unverified)', () => {
    const rawPlan: TravelPlan = {
      accommodationGuidance: 'Stay nearby.',
      placesToVisit: [
        {
          verifiedPlaceId: 'VP_NONEXISTENT_999',
          name: 'Fictional Wonder Park',
          reason: 'Gemini hallucinated catalog id',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Sunny',
      budgetTips: [],
      itinerary: [],
      includeDayByDayItinerary: false
    };

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(rawPlan, FULL_MUMBAI_CATALOG);
    assert.equal(sanitized.placesToVisit.length, 1);
    assert.equal(sanitized.placesToVisit[0].name, 'Fictional Wonder Park');
    // Does NOT become verified
    assert.equal(sanitized.placesToVisit[0].verifiedPlaceId, null);
    assert.equal(sanitized.placesToVisit[0].verificationStatus, 'unverified');
    assert.equal(sanitized.placesToVisit[0].source, 'ai_suggestion');
    assert.ok(validationReport.warnings.some(w => w.includes('Removed invalid/unknown catalog ID')));
  });

  // TEST 7 — AI SUGGESTION WITHOUT CATALOG ID
  await runScenario('TEST 7 - AI Suggestion Without Catalog ID (Valid Structure Accepted)', () => {
    const rawJson = JSON.stringify({
      accommodationGuidance: 'Stay in Colaba.',
      placesToVisit: [
        {
          name: 'Flora Fountain Heritage Walk',
          reason: 'Victorian gothic architecture stroll.',
          bestTime: 'Evening'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Pleasant breeze',
      budgetTips: ['Take walking shoes'],
      itinerary: []
    });

    const parsed = cleanAndParseJSON(rawJson, { requireItinerary: false, expectedDays: 1 });
    assert.equal(parsed.placesToVisit.length, 1);
    assert.equal(parsed.placesToVisit[0].name, 'Flora Fountain Heritage Walk');

    const { plan: sanitized } = validateAndSanitizeTravelPlan(parsed, FULL_MUMBAI_CATALOG);
    assert.equal(sanitized.placesToVisit.length, 1);
    assert.equal(sanitized.placesToVisit[0].verificationStatus, 'unverified');
    assert.equal(sanitized.placesToVisit[0].source, 'ai_suggestion');
  });

  // TEST 8 — MALFORMED MODEL OUTPUT
  await runScenario('TEST 8 - Malformed Model Output (Rejects Malformed JSON without Demo Fallback)', () => {
    const malformedJson = '```json { "accommodationGuidance": "Broken JSON without closing bracket"';

    assert.throws(
      () => cleanAndParseJSON(malformedJson, { requireItinerary: false, expectedDays: 1 }),
      (err: any) => err.message.includes('Invalid JSON') || err.message.includes('JSON')
    );
  });

  // TEST 9 — GEMINI FAILURE
  await runScenario('TEST 9 - Gemini Failure (Returns Error, No Demo Plan Fallback)', async () => {
    const req: GeneratePlanRequest = {
      destination: 'Mumbai',
      numberOfDays: 1,
      budgetInr: 10000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: true
    };

    const mockFailingFetch = createMockFetch('API Unavailable', 503);

    await assert.rejects(
      async () => generateTravelPlanService(req, { catalogOverride: FULL_MUMBAI_CATALOG, fetchFn: mockFailingFetch }),
      (err: any) => {
        assert.ok(!err.message.includes('Pune'));
        return true;
      }
    );
  });

  // TEST 10 — DESTINATION RESOLUTION FAILURE
  await runScenario('TEST 10 - Destination Resolution Failure (No Coordinate Substitution (0,0))', async () => {
    const mockEmptyNominatim: typeof fetch = async () => new Response('[]', { status: 200 });

    await assert.rejects(
      async () => resolveDestination('XyzzNonExistentTown999', { fetchFn: mockEmptyNominatim as any }),
      (err: any) => {
        assert.ok(err instanceof OsmNoResultsError);
        assert.ok(err.message.includes('No geographic match found'));
        return true;
      }
    );
  });

  // TEST 11 — ITINERARY ENABLED
  await runScenario('TEST 11 - Itinerary Enabled (Catalog & AI Suggestions Coexist)', () => {
    const fullPlanWithBoth: TravelPlan = {
      accommodationGuidance: 'Stay at The Taj Mahal Palace, Mumbai.',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Gateway of India', reason: 'Monument', bestTime: 'Morning' },
        { name: 'Colaba Causeway Bazaar', reason: 'Bustling street shopping', bestTime: 'Evening' }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Warm',
      budgetTips: [],
      includeDayByDayItinerary: true,
      itinerary: [
        {
          day: 1,
          morning: 'Tour Gateway of India',
          morningPlaceId: 'VP_01',
          afternoon: 'Rest at hotel',
          evening: 'Shopping at Colaba Causeway Bazaar',
          notes: '',
          alternative: ''
        }
      ]
    };

    const { plan: sanitized } = validateAndSanitizeTravelPlan(fullPlanWithBoth, FULL_MUMBAI_CATALOG);
    assert.equal(sanitized.includeDayByDayItinerary, true);
    assert.equal(sanitized.itinerary.length, 1);
    assert.equal(sanitized.itinerary[0].morningPlaceId, 'VP_01');
    // Evening activity mentions unverified place text, which is preserved
    assert.ok(sanitized.itinerary[0].evening.includes('Colaba Causeway Bazaar'));
    assert.equal(sanitized.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(sanitized.placesToVisit[1].verificationStatus, 'unverified');
  });

  // TEST 12 — ITINERARY DISABLED
  await runScenario('TEST 12 - Itinerary Disabled (Itinerary Empty [], Other Sections Intact)', () => {
    const planNoItinerary: TravelPlan = {
      accommodationGuidance: 'Stay at The Taj Mahal Palace, Mumbai.',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Gateway of India', reason: 'Monument', bestTime: 'Morning' },
        { name: 'Marine Drive Promenade', reason: 'Scenic sunset view', bestTime: 'Evening' }
      ],
      foodAndLocalExperiences: [
        { verifiedPlaceId: 'VP_03', name: 'Leopold Cafe', reason: 'Iconic cafe' }
      ],
      activities: [],
      weatherAdvice: 'Tropical coastal climate',
      budgetTips: ['Use metered taxis'],
      includeDayByDayItinerary: false,
      itinerary: []
    };

    const { plan: sanitized } = validateAndSanitizeTravelPlan(planNoItinerary, FULL_MUMBAI_CATALOG);
    assert.equal(sanitized.includeDayByDayItinerary, false);
    assert.equal(sanitized.itinerary.length, 0);
    assert.equal(sanitized.placesToVisit.length, 2);
    assert.equal(sanitized.foodAndLocalExperiences.length, 1);
    assert.ok(sanitized.accommodationGuidance.includes('The Taj Mahal Palace'));
  });

  // TEST 13 — PLAN MODIFICATION
  await runScenario('TEST 13 - Plan Modification (Permissive Policy & Preservation of Original)', async () => {
    const originalPlan: TravelPlan = {
      accommodationGuidance: 'Original accommodation guidance',
      placesToVisit: [{ verifiedPlaceId: 'VP_01', name: 'Gateway of India', reason: 'Original', bestTime: 'Morning' }],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Sunny',
      budgetTips: [],
      itinerary: [{ day: 1, morning: 'Visit Gateway', afternoon: '', evening: '', notes: '', alternative: '' }],
      includeDayByDayItinerary: true
    };

    const modifyRequest: ModifyPlanRequest = {
      originalDetails: {
        destination: 'Mumbai',
        numberOfDays: 1,
        budgetInr: 10000,
        numberOfTravellers: 1,
        includeDayByDayItinerary: true
      },
      currentPlan: originalPlan,
      modificationRequest: 'Add a sunset walk at Marine Drive'
    };

    const aiModifiedJson = JSON.stringify({
      accommodationGuidance: 'Original accommodation guidance',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Gateway of India', reason: 'Original', bestTime: 'Morning' },
        { name: 'Marine Drive Promenade', reason: 'Added evening sunset walk' } // Unverified AI suggestion
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Sunny',
      budgetTips: [],
      itinerary: [
        { day: 1, morning: 'Visit Gateway', afternoon: 'Relax', evening: 'Walk at Marine Drive Promenade', notes: '', alternative: '' }
      ]
    });

    const result = await modifyTravelPlanService(modifyRequest, {
      catalogOverride: FULL_MUMBAI_CATALOG,
      fetchFn: createMockFetch(aiModifiedJson)
    });

    assert.equal(result.plan.placesToVisit.length, 2);
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(result.plan.placesToVisit[1].name, 'Marine Drive Promenade');
    assert.equal(result.plan.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(result.plan.placesToVisit[1].source, 'ai_suggestion');
    assert.equal(result.plan.includeDayByDayItinerary, true);
  });

  // TEST 14 — SAVED PLAN COMPATIBILITY
  await runScenario('TEST 14 - Saved Plan Compatibility (Legacy Plans Without Verification Fields)', () => {
    const legacyPlan = {
      accommodationGuidance: 'Historic hotel recommendation',
      placesToVisit: [
        { name: 'Gateway of India', reason: 'Landmark', bestTime: 'Morning' },
        { name: 'Old Unverified Bookshop', reason: 'Cozy book store' }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Pleasant',
      budgetTips: ['Carry cash'],
      itinerary: []
    };

    const { plan: sanitized } = validateAndSanitizeTravelPlan(legacyPlan as any, FULL_MUMBAI_CATALOG);
    // Legacy Gateway of India matches catalog by name
    assert.equal(sanitized.placesToVisit[0].verifiedPlaceId, 'VP_01');
    assert.equal(sanitized.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(sanitized.placesToVisit[0].source, 'catalog');

    // Legacy unverified bookshop survives as unverified
    assert.equal(sanitized.placesToVisit[1].verifiedPlaceId, null);
    assert.equal(sanitized.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(sanitized.placesToVisit[1].source, 'ai_suggestion');
  });

  // TEST 15 — PROVIDER FAILURE WITH SUCCESSFUL DESTINATION RESOLUTION
  await runScenario('TEST 15 - Provider Failure with Successful Destination Resolution (Overpass 500)', async () => {
    const mockFailingOverpass: typeof fetch = async () => new Response('Overpass 500 error', { status: 500 });

    // Place catalog discovery fails gracefully, producing 0 verified places
    const catalog = await buildVerifiedPlaceCatalog(MOCK_DEST_RURAL, { fetchFn: mockFailingOverpass as any });
    assert.equal(catalog.places.length, 0);

    // AI generation continues with 0 verified places instead of failing
    const aiResponse = JSON.stringify({
      accommodationGuidance: 'Look for local rural homestays.',
      placesToVisit: [
        { name: 'Chandekasare Village Square', reason: 'Local cultural gathering', bestTime: 'Morning' }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Dry',
      budgetTips: ['Cash only'],
      itinerary: []
    });

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: catalog,
      fetchFn: createMockFetch(aiResponse)
    });

    assert.equal(result.isDemo, false);
    assert.equal(result.plan.placesToVisit.length, 1);
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'unverified');
  });

  console.log('\n================================================================');
  console.log(`ALL 15 SECTION 14 SCENARIOS PASSED! (${passed}/${total})`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runSection14Suite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
