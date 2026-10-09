import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config();

import {
  generateTravelPlanService,
  modifyTravelPlanService,
  cleanAndParseJSON
} from './src/aiService.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';
import { resolveDestination } from './src/services/destinationResolver.js';
import { buildVerifiedPlaceCatalog } from './src/services/placeCatalog.js';
import { pool } from './src/db.js';
import { createUser } from './src/db/users.js';
import {
  saveTravelPlan,
  getTravelPlanByIdForUser,
  getTravelPlansByUserId
} from './src/db/travelPlans.js';
import type {
  VerifiedPlaceCatalog,
  VerifiedPlace,
  TravelPlan,
  GeneratePlanRequest,
  ModifyPlanRequest,
  ResolvedDestination
} from './src/types.js';

// Helper: Wrap mock response in Gemini candidate JSON
function createMockGeminiFetch(responseBody: string, status = 200, delayMs = 0): typeof fetch {
  return async (url: any) => {
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    const urlStr = String(url);
    if (status !== 200) {
      return new Response(responseBody, { status });
    }
    if (urlStr.includes('generateContent')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: responseBody }]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(responseBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  testCount++;
  process.stdout.write(`[TEST ${testCount}] ${name}... `);
  try {
    await fn();
    passCount++;
    console.log('PASSED');
  } catch (err: any) {
    console.log('FAILED');
    console.error(err);
    throw err;
  }
}

async function runComprehensiveAudit() {
  console.log('================================================================');
  console.log('TRAVELGENIE: FINAL SPARSE-DESTINATION LIVE VERIFICATION SUITE');
  console.log('================================================================\n');

  // ==========================================================================
  // SECTION 1: GENUINELY SPARSE CATALOG (MOCK GEMINI - EXPLICITLY LABELED)
  // ==========================================================================
  console.log('--- SECTION 1: Genuinely Sparse Catalog Tests (Deterministic Mock) ---');

  const SPARSE_DEST: ResolvedDestination = {
    originalInput: 'Chandekasare',
    canonicalName: 'Kopargaon',
    formattedAddress: 'Primary Health Centre, Chandekasare, Kopargaon, Maharashtra, India',
    latitude: 19.8403,
    longitude: 74.4364,
    addressComponents: []
  };

  const PLACE_TEMPLE: VerifiedPlace = {
    internalId: 'VP_01',
    provider: 'osm',
    providerPlaceId: 'osm:node/1001',
    name: 'Chandekasare Ancient Temple',
    primaryCategory: 'attraction',
    types: ['temple'],
    formattedAddress: 'Chandekasare Village',
    location: { latitude: 19.8403, longitude: 74.4364 },
    distanceMeters: 50,
    localityRelation: 'exact_destination',
    verifiedAt: new Date().toISOString()
  };

  const PLACE_HANUMAN: VerifiedPlace = {
    internalId: 'VP_02',
    provider: 'osm',
    providerPlaceId: 'osm:node/1002',
    name: 'Gramdaivat Hanuman Mandir',
    primaryCategory: 'attraction',
    types: ['temple'],
    formattedAddress: 'Main Chowk, Chandekasare',
    location: { latitude: 19.841, longitude: 74.437 },
    distanceMeters: 120,
    localityRelation: 'exact_destination',
    verifiedAt: new Date().toISOString()
  };

  // Exactly 2 verified places: 0 accommodations, 0 restaurants, 0 activities
  const TRULY_SPARSE_CATALOG: VerifiedPlaceCatalog = {
    destination: SPARSE_DEST,
    places: [PLACE_TEMPLE, PLACE_HANUMAN],
    byCategory: {
      accommodation: [],
      attraction: [PLACE_TEMPLE, PLACE_HANUMAN],
      restaurant: [],
      activity: [],
      poi: []
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      searchRadiiMeters: [5000, 15000, 25000],
      totalVerifiedPlaces: 2,
      dataSource: 'OpenStreetMap (ODbL)'
    }
  };

  await runTest('1.1 Sparse Catalog: Gemini prompt receives sparse instructions permitting non-catalog places', async () => {
    let capturedUserPrompt = '';
    const mockCapturingFetch: typeof fetch = async (url, init: any) => {
      const body = JSON.parse(init.body);
      capturedUserPrompt = body.contents?.[0]?.parts?.[0]?.text || '';
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      accommodationGuidance: 'Homestays or lodges in neighboring Kopargaon are recommended.',
                      placesToVisit: [
                        { verifiedPlaceId: 'VP_01', name: 'Chandekasare Ancient Temple', reason: 'Sacred heritage', bestTime: 'Morning' },
                        { name: 'Godavari Riverbank Stroll', reason: 'Scenic sunset view', bestTime: 'Evening' }
                      ],
                      foodAndLocalExperiences: [],
                      activities: [],
                      weatherAdvice: 'Warm and sunny',
                      budgetTips: ['Carry cash'],
                      itinerary: []
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: TRULY_SPARSE_CATALOG,
      fetchFn: mockCapturingFetch
    });

    assert.ok(capturedUserPrompt.includes('CATALOG COVERAGE NOTICE:'));
    assert.ok(capturedUserPrompt.includes('partial or sparse coverage'));
    assert.ok(capturedUserPrompt.includes('supplement with authentic places and experiences from your own knowledge'));
    assert.ok(capturedUserPrompt.includes('LOCALITY EMPHASIS'));
    assert.equal(result.isDemo, false);
    assert.equal(result.plan.placesToVisit.length, 2);
  });

  await runTest('1.2 Sparse Catalog: Dual-source validation distinguishes verified vs AI suggestions', async () => {
    const aiResponseWithMixedPlaces = JSON.stringify({
      accommodationGuidance: 'Local village homestays or budget hotels in nearby Kopargaon.',
      placesToVisit: [
        {
          verifiedPlaceId: 'VP_01',
          name: 'Chandekasare Ancient Temple',
          reason: 'Historic landmark.',
          bestTime: 'Morning'
        },
        {
          verifiedPlaceId: 'VP_02',
          name: 'Gramdaivat Hanuman Mandir',
          reason: 'Spiritual village shrine.',
          bestTime: 'Afternoon'
        },
        {
          // Non-catalog AI suggestion 1
          name: 'Godavari River Bend Lookout',
          reason: 'Peaceful natural vantage point overlooking the river.',
          bestTime: 'Late Afternoon'
        },
        {
          // Non-catalog AI suggestion 2 with fabricated catalog ID
          verifiedPlaceId: 'VP_FAKE_99',
          name: 'Old Sugar Mill Memorial',
          reason: 'Local industrial heritage artifact.',
          bestTime: 'Evening'
        }
      ],
      foodAndLocalExperiences: [
        {
          // Non-catalog AI suggestion for food
          name: 'Traditional Hurda & Pithla Bhakri Stall',
          reason: 'Seasonal agro-tourism meal.'
        }
      ],
      activities: [
        {
          // Non-catalog AI suggestion for activity
          name: 'Rural Village Farm Walk',
          reason: 'Experience sugarcane agriculture firsthand.'
        }
      ],
      weatherAdvice: 'Pleasant mornings with warm afternoons.',
      budgetTips: ['Use shared auto-rickshaws between village and town.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Chandekasare Ancient Temple',
          morningPlaceId: 'VP_01',
          afternoon: 'Worship at Gramdaivat Hanuman Mandir',
          afternoonPlaceId: 'VP_02',
          evening: 'Sunset walk at Godavari River Bend Lookout',
          notes: 'Dress modestly in village',
          alternative: 'Quiet walk through the farms'
        }
      ]
    });

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: true
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: TRULY_SPARSE_CATALOG,
      fetchFn: createMockGeminiFetch(aiResponseWithMixedPlaces)
    });

    assert.equal(result.isDemo, false);
    assert.equal(result.plan.placesToVisit.length, 4);

    // Item 1: Verified
    assert.equal(result.plan.placesToVisit[0].verifiedPlaceId, 'VP_01');
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(result.plan.placesToVisit[0].source, 'catalog');

    // Item 2: Verified
    assert.equal(result.plan.placesToVisit[1].verifiedPlaceId, 'VP_02');
    assert.equal(result.plan.placesToVisit[1].verificationStatus, 'verified');
    assert.equal(result.plan.placesToVisit[1].source, 'catalog');

    // Item 3: AI suggestion without ID survives as unverified
    assert.equal(result.plan.placesToVisit[2].name, 'Godavari River Bend Lookout');
    assert.equal(result.plan.placesToVisit[2].verifiedPlaceId, null);
    assert.equal(result.plan.placesToVisit[2].verificationStatus, 'unverified');
    assert.equal(result.plan.placesToVisit[2].source, 'ai_suggestion');

    // Item 4: AI suggestion with fake ID VP_FAKE_99 has ID stripped to null and survives as unverified
    assert.equal(result.plan.placesToVisit[3].name, 'Old Sugar Mill Memorial');
    assert.equal(result.plan.placesToVisit[3].verifiedPlaceId, null);
    assert.equal(result.plan.placesToVisit[3].verificationStatus, 'unverified');
    assert.equal(result.plan.placesToVisit[3].source, 'ai_suggestion');

    // Food AI suggestion survives as unverified
    assert.equal(result.plan.foodAndLocalExperiences[0].name, 'Traditional Hurda & Pithla Bhakri Stall');
    assert.equal(result.plan.foodAndLocalExperiences[0].verificationStatus, 'unverified');
    assert.equal(result.plan.foodAndLocalExperiences[0].source, 'ai_suggestion');

    // Activity AI suggestion survives as unverified
    assert.equal(result.plan.activities[0].name, 'Rural Village Farm Walk');
    assert.equal(result.plan.activities[0].verificationStatus, 'unverified');
    assert.equal(result.plan.activities[0].source, 'ai_suggestion');

    // Itinerary retains day 1 schedule with verified morning/afternoon IDs
    assert.equal(result.plan.itinerary.length, 1);
    assert.equal(result.plan.itinerary[0].morningPlaceId, 'VP_01');
    assert.equal(result.plan.itinerary[0].afternoonPlaceId, 'VP_02');
    assert.ok(result.plan.itinerary[0].evening.includes('Godavari River Bend Lookout'));
  });

  // ==========================================================================
  // SECTION 2: EMPTY CATALOG TESTS
  // ==========================================================================
  console.log('\n--- SECTION 2: Empty Catalog Tests ---');

  const EMPTY_CATALOG: VerifiedPlaceCatalog = {
    destination: SPARSE_DEST,
    places: [],
    byCategory: { accommodation: [], attraction: [], restaurant: [], activity: [], poi: [] },
    metadata: { generatedAt: new Date().toISOString(), searchRadiiMeters: [5000, 15000, 25000], totalVerifiedPlaces: 0, dataSource: 'OpenStreetMap (ODbL)' }
  };

  await runTest('2.1 Empty Catalog: Destination resolved, 0 places found -> Gemini generates valid plan', async () => {
    const aiResponseForEmptyCatalog = JSON.stringify({
      accommodationGuidance: 'Check lodging options in nearest railhead or rural homestays.',
      placesToVisit: [
        {
          name: 'Village Central Chawdi',
          reason: 'Historic public meeting square.',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Warm and dry.',
      budgetTips: ['Local cash required.'],
      itinerary: []
    });

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 2500,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: EMPTY_CATALOG,
      fetchFn: createMockGeminiFetch(aiResponseForEmptyCatalog)
    });

    assert.equal(result.isDemo, false);
    assert.equal(result.plan.placesToVisit.length, 1);
    assert.equal(result.plan.placesToVisit[0].name, 'Village Central Chawdi');
    assert.equal(result.plan.placesToVisit[0].verifiedPlaceId, null);
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'unverified');
    assert.equal(result.plan.placesToVisit[0].source, 'ai_suggestion');
  });

  await runTest('2.2 Empty Catalog: Gemini API failure returns error, NOT a template plan', async () => {
    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 2500,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    const mockFailingFetch = createMockGeminiFetch('503 Service Unavailable', 503);

    await assert.rejects(
      async () => generateTravelPlanService(req, {
        catalogOverride: EMPTY_CATALOG,
        fetchFn: mockFailingFetch
      }),
      (err: any) => {
        assert.ok(!err.message.toLowerCase().includes('pune'));
        assert.ok(err.message.includes('unavailable') || err.message.includes('503') || err.message.includes('AI'));
        return true;
      }
    );
  });

  // ==========================================================================
  // SECTION 3: SEPARATE DESTINATION VS GEMINI FAILURES
  // ==========================================================================
  console.log('\n--- SECTION 3: Separate Destination vs Gemini Failure Tests ---');

  await runTest('3A. Destination-Resolution Failure: Fails before Gemini is called', async () => {
    let geminiWasCalled = false;
    const mockNominatimFailingFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('nominatim.openstreetmap.org')) {
        return new Response('[]', { status: 200 }); // 0 results returned
      }
      if (urlStr.includes('generateContent')) {
        geminiWasCalled = true;
      }
      return new Response('{}', { status: 200 });
    };

    const req: GeneratePlanRequest = {
      destination: 'NonExistentGhostTown99999',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    await assert.rejects(
      async () => generateTravelPlanService(req, { fetchFn: mockNominatimFailingFetch }),
      (err: any) => {
        assert.ok(err.message.includes('Unable to locate destination') || err.message.includes('Failed to resolve'));
        return true;
      }
    );
    assert.equal(geminiWasCalled, false, 'Gemini must NOT be called when destination resolution fails');
  });

  await runTest('3B. Gemini Failure After Successful Resolution: Produces error, NO demo plan', async () => {
    // Geocoding and Overpass succeed, but Gemini fails with 503
    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('nominatim.openstreetmap.org')) {
        return new Response(JSON.stringify([{
          display_name: 'Chandekasare, Kopargaon, Maharashtra, India',
          lat: '19.8403',
          lon: '74.4364',
          importance: 0.5,
          address: { village: 'Chandekasare', town: 'Kopargaon', state: 'Maharashtra', country: 'India' }
        }]), { status: 200 });
      }
      if (urlStr.includes('overpass-api.de')) {
        return new Response(JSON.stringify({ elements: [] }), { status: 200 });
      }
      if (urlStr.includes('generateContent')) {
        return new Response('503 Service Unavailable', { status: 503 });
      }
      return new Response('{}', { status: 200 });
    };

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    await assert.rejects(
      async () => generateTravelPlanService(req, { fetchFn: mockFetch }),
      (err: any) => {
        assert.ok(!err.message.toLowerCase().includes('pune'));
        assert.ok(err.message.includes('unavailable') || err.message.includes('503') || err.message.includes('AI'));
        return true;
      }
    );
  });

  // ==========================================================================
  // SECTION 4: DESTINATION PRESERVATION & LOCALITY FOCUS
  // ==========================================================================
  console.log('\n--- SECTION 4: Destination Preservation & Locality Focus ---');

  await runTest('4. Destination Preservation: Preserves requested locality alongside administrative center', async () => {
    let capturedUserPrompt = '';
    const mockFetch: typeof fetch = async (url, init: any) => {
      const body = JSON.parse(init.body);
      capturedUserPrompt = body.contents?.[0]?.parts?.[0]?.text || '';
      return new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  accommodationGuidance: 'Stay in Kopargaon or Chandekasare homestays.',
                  placesToVisit: [{ name: 'Chandekasare River View', reason: 'Scenic', bestTime: 'Morning' }],
                  foodAndLocalExperiences: [],
                  activities: [],
                  weatherAdvice: 'Warm',
                  budgetTips: [],
                  itinerary: []
                })
              }]
            }
          }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: false
    };

    const result = await generateTravelPlanService(req, {
      catalogOverride: TRULY_SPARSE_CATALOG,
      fetchFn: mockFetch
    });

    // Check prompt preservation
    assert.ok(capturedUserPrompt.includes('Chandekasare (located in Kopargaon'));
    assert.ok(capturedUserPrompt.includes('LOCALITY EMPHASIS: The traveler specifically requested "Chandekasare"'));

    // Check final plan resolvedDestination preservation
    assert.equal(result.plan.resolvedDestination?.originalInput, 'Chandekasare');
    assert.equal(result.plan.resolvedDestination?.canonicalName, 'Kopargaon');
  });

  // ==========================================================================
  // SECTION 5: VERIFY AI SUGGESTION TYPES ACROSS ALL SECTIONS
  // ==========================================================================
  console.log('\n--- SECTION 5: Verify AI Suggestion Types Across All Sections ---');

  await runTest('5.1 Recommendation sections support explicit verification metadata and price sanitization', () => {
    const rawPlan: TravelPlan = {
      accommodationGuidance: 'Stay at Grand Rural Palace for ₹6,500/night.',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Chandekasare Ancient Temple', reason: 'Sacred', bestTime: 'Morning' },
        { name: 'Unverified Scenic Point', reason: 'Scenic view', bestTime: 'Evening' }
      ],
      foodAndLocalExperiences: [
        { name: 'Roadside Chai & Bhajji', reason: 'Popular snack spot' }
      ],
      activities: [
        { name: 'Bullock Cart Village Tour', reason: 'Cultural experience' }
      ],
      weatherAdvice: 'Sunny',
      budgetTips: ['Rooms cost ₹6,500 per night.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Chandekasare Ancient Temple',
          morningPlaceId: 'VP_01',
          afternoon: 'Rest at accommodation',
          evening: 'Tour village on bullock cart',
          notes: '',
          alternative: ''
        }
      ],
      includeDayByDayItinerary: true
    };

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(rawPlan, TRULY_SPARSE_CATALOG);

    // placesToVisit
    assert.equal(sanitized.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(sanitized.placesToVisit[0].source, 'catalog');
    assert.equal(sanitized.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(sanitized.placesToVisit[1].source, 'ai_suggestion');

    // foodAndLocalExperiences
    assert.equal(sanitized.foodAndLocalExperiences[0].verificationStatus, 'unverified');
    assert.equal(sanitized.foodAndLocalExperiences[0].source, 'ai_suggestion');

    // activities
    assert.equal(sanitized.activities[0].verificationStatus, 'unverified');
    assert.equal(sanitized.activities[0].source, 'ai_suggestion');

    // accommodationGuidance price sanitized
    assert.ok(!sanitized.accommodationGuidance.includes('₹6,500/night'));
    assert.ok(sanitized.accommodationGuidance.includes('(current accommodation pricing is unavailable)'));

    // itinerary free text preserved without inventing place IDs
    assert.equal(sanitized.itinerary[0].morningPlaceId, 'VP_01');
    assert.equal(sanitized.itinerary[0].afternoonPlaceId, undefined);
    assert.ok(sanitized.itinerary[0].evening.includes('bullock cart'));
  });

  await runTest('5.2 Legacy saved plans load safely without throwing', () => {
    const legacyPlan = {
      accommodationGuidance: 'Comfortable rural stay',
      placesToVisit: [{ name: 'Chandekasare Ancient Temple', reason: 'Temple', bestTime: 'Morning' }],
      foodAndLocalExperiences: [{ name: 'Local Tea Stall', reason: 'Refreshment' }],
      activities: [],
      weatherAdvice: 'Pleasant',
      budgetTips: ['Carry cash'],
      itinerary: []
    };

    const { plan: sanitized } = validateAndSanitizeTravelPlan(legacyPlan as any, TRULY_SPARSE_CATALOG);
    assert.equal(sanitized.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(sanitized.foodAndLocalExperiences[0].verificationStatus, 'unverified');
    assert.equal(sanitized.includeDayByDayItinerary, false);
  });

  // ==========================================================================
  // SECTION 6: FRONTEND DATA COMPATIBILITY
  // ==========================================================================
  console.log('\n--- SECTION 6: Frontend Data Compatibility ---');

  await runTest('6. Frontend schema handles missing optional fields without errors', () => {
    const sparsePlan: TravelPlan = {
      accommodationGuidance: 'Basic accommodation guidance',
      placesToVisit: [
        // Verified entry with minimal fields
        { verifiedPlaceId: 'VP_01', name: 'Verified Temple', reason: 'Sacred', bestTime: 'Morning', verificationStatus: 'verified', source: 'catalog' },
        // AI suggestion without catalog ID, coordinates, or address
        { name: 'AI Scenic Point', reason: 'Scenic', bestTime: 'Evening', verificationStatus: 'unverified', source: 'ai_suggestion', verifiedPlaceId: null }
      ],
      foodAndLocalExperiences: [
        { name: 'AI Dhaba', reason: 'Food', verificationStatus: 'unverified', source: 'ai_suggestion' }
      ],
      activities: [],
      weatherAdvice: 'Sunny',
      budgetTips: [],
      itinerary: []
    };

    // Serialize and parse to simulate API JSON round-trip
    const jsonStr = JSON.stringify(sparsePlan);
    const parsed = JSON.parse(jsonStr) as TravelPlan;

    assert.equal(parsed.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(parsed.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(parsed.placesToVisit[1].verifiedPlaceId, null);
    assert.equal(parsed.foodAndLocalExperiences[0].verificationStatus, 'unverified');
  });

  // ==========================================================================
  // SECTION 7: REAL POSTGRESQL PERSISTENCE & MODIFICATION
  // ==========================================================================
  console.log('\n--- SECTION 7: Real PostgreSQL Persistence & Modification Tests ---');

  let testUserId = '';
  let testPlanId = '';

  await runTest('7.1 PostgreSQL: Create user in real database (port 5434)', async () => {
    const testUsername = `testuser_${Date.now()}`;
    const user = await createUser(testUsername, 'dummy_salt:dummy_derived_hash');
    assert.ok(user.id);
    assert.equal(user.username, testUsername);
    testUserId = user.id;
  });

  await runTest('7.2 PostgreSQL: Save plan with verified and unverified recommendations', async () => {
    const planToSave: TravelPlan = {
      accommodationGuidance: 'Stay in Kopargaon.',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Chandekasare Ancient Temple', reason: 'Temple', bestTime: 'Morning', verificationStatus: 'verified', source: 'catalog' },
        { verifiedPlaceId: null, name: 'Godavari River Bend Lookout', reason: 'River view', bestTime: 'Evening', verificationStatus: 'unverified', source: 'ai_suggestion' }
      ],
      foodAndLocalExperiences: [
        { name: 'Rural Dhaba Experience', reason: 'Maharashtrian food', verificationStatus: 'unverified', source: 'ai_suggestion', verifiedPlaceId: null }
      ],
      activities: [],
      weatherAdvice: 'Clear skies',
      budgetTips: ['Carry cash'],
      itinerary: [
        { day: 1, morning: 'Temple visit', morningPlaceId: 'VP_01', afternoon: 'Lunch', evening: 'Stroll', notes: '', alternative: '' }
      ],
      includeDayByDayItinerary: true,
      resolvedDestination: SPARSE_DEST,
      verifiedPlacesCatalog: TRULY_SPARSE_CATALOG.places
    };

    const details: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      interests: ['Sightseeing'],
      accommodationPreference: 'Budget',
      activityLevel: 'Relaxed',
      includeDayByDayItinerary: true
    };

    const saved = await saveTravelPlan(testUserId, details, planToSave);
    assert.ok(saved.id);
    testPlanId = saved.id;
  });

  await runTest('7.3 PostgreSQL: Retrieve plan and verify verification metadata survived round-trip', async () => {
    const record = await getTravelPlanByIdForUser(testPlanId, testUserId);
    assert.ok(record);
    assert.equal(record.destination, 'Chandekasare');

    const p = record.plan;
    assert.equal(p.placesToVisit.length, 2);
    // Verified item check
    assert.equal(p.placesToVisit[0].name, 'Chandekasare Ancient Temple');
    assert.equal(p.placesToVisit[0].verifiedPlaceId, 'VP_01');
    assert.equal(p.placesToVisit[0].verificationStatus, 'verified');
    assert.equal(p.placesToVisit[0].source, 'catalog');

    // Unverified AI suggestion check
    assert.equal(p.placesToVisit[1].name, 'Godavari River Bend Lookout');
    assert.equal(p.placesToVisit[1].verifiedPlaceId, null);
    assert.equal(p.placesToVisit[1].verificationStatus, 'unverified');
    assert.equal(p.placesToVisit[1].source, 'ai_suggestion');

    // Food check
    assert.equal(p.foodAndLocalExperiences[0].verificationStatus, 'unverified');
    assert.equal(p.foodAndLocalExperiences[0].source, 'ai_suggestion');
  });

  await runTest('7.4 PostgreSQL: Fetch user history summaries', async () => {
    const summaries = await getTravelPlansByUserId(testUserId);
    assert.ok(Array.isArray(summaries));
    assert.ok(summaries.length >= 1);
    const found = summaries.find(s => s.id === testPlanId);
    assert.ok(found);
    assert.equal(found.destination, 'Chandekasare');
  });

  await runTest('7.5 PostgreSQL: Modify plan and save updated plan with new unverified AI suggestion', async () => {
    const existing = await getTravelPlanByIdForUser(testPlanId, testUserId);
    assert.ok(existing);

    const modifyRequest: ModifyPlanRequest = {
      originalDetails: {
        destination: existing.destination,
        numberOfDays: existing.numberOfDays,
        budgetInr: existing.budgetInr,
        numberOfTravellers: existing.numberOfTravellers,
        includeDayByDayItinerary: true
      },
      currentPlan: existing.plan,
      modificationRequest: 'Add a visit to the local pottery artisan'
    };

    const aiModifiedJson = JSON.stringify({
      accommodationGuidance: 'Stay in Kopargaon.',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Chandekasare Ancient Temple', reason: 'Temple', bestTime: 'Morning' },
        { name: 'Godavari River Bend Lookout', reason: 'River view', bestTime: 'Afternoon' },
        { name: 'Village Pottery Artisan Workshop', reason: 'Traditional handmade clay pottery' } // New AI suggestion
      ],
      foodAndLocalExperiences: existing.plan.foodAndLocalExperiences,
      activities: existing.plan.activities,
      weatherAdvice: existing.plan.weatherAdvice,
      budgetTips: existing.plan.budgetTips,
      itinerary: [
        { day: 1, morning: 'Temple visit', morningPlaceId: 'VP_01', afternoon: 'Pottery Workshop', evening: 'River lookout', notes: '', alternative: '' }
      ]
    });

    const modifiedResult = await modifyTravelPlanService(modifyRequest, {
      catalogOverride: TRULY_SPARSE_CATALOG,
      fetchFn: createMockGeminiFetch(aiModifiedJson)
    });

    assert.equal(modifiedResult.plan.placesToVisit.length, 3);
    assert.equal(modifiedResult.plan.placesToVisit[2].name, 'Village Pottery Artisan Workshop');
    assert.equal(modifiedResult.plan.placesToVisit[2].verificationStatus, 'unverified');
    assert.equal(modifiedResult.plan.placesToVisit[2].source, 'ai_suggestion');

    // Save modified plan in database
    const savedModified = await saveTravelPlan(testUserId, existing, modifiedResult.plan);
    assert.ok(savedModified.id);

    // Re-read from database
    const reloaded = await getTravelPlanByIdForUser(savedModified.id, testUserId);
    assert.ok(reloaded);
    assert.equal(reloaded.plan.placesToVisit.length, 3);
    assert.equal(reloaded.plan.placesToVisit[2].name, 'Village Pottery Artisan Workshop');
    assert.equal(reloaded.plan.placesToVisit[2].verificationStatus, 'unverified');
    assert.equal(reloaded.plan.placesToVisit[2].source, 'ai_suggestion');
  });

  await runTest('7.6 PostgreSQL: Failed modification does not overwrite existing plan', async () => {
    const beforeFail = await getTravelPlanByIdForUser(testPlanId, testUserId);
    assert.ok(beforeFail);

    const modifyRequest: ModifyPlanRequest = {
      originalDetails: {
        destination: beforeFail.destination,
        numberOfDays: beforeFail.numberOfDays,
        budgetInr: beforeFail.budgetInr,
        numberOfTravellers: beforeFail.numberOfTravellers,
        includeDayByDayItinerary: true
      },
      currentPlan: beforeFail.plan,
      modificationRequest: 'Attempt failing modification'
    };

    // AI throws 500 error
    const mockFailingFetch = createMockGeminiFetch('Internal Server Error', 500);

    await assert.rejects(
      async () => modifyTravelPlanService(modifyRequest, {
        catalogOverride: TRULY_SPARSE_CATALOG,
        fetchFn: mockFailingFetch
      })
    );

    // Ensure database record was NOT changed
    const afterFail = await getTravelPlanByIdForUser(testPlanId, testUserId);
    assert.ok(afterFail);
    assert.equal(afterFail.plan.placesToVisit.length, beforeFail.plan.placesToVisit.length);
    assert.equal(afterFail.plan.placesToVisit[0].name, 'Chandekasare Ancient Temple');
    assert.equal(afterFail.plan.placesToVisit[1].name, 'Godavari River Bend Lookout');
  });

  // Cleanup test user and plans
  await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
  console.log(`[Cleanup]: Removed test user ${testUserId}`);

  console.log('\n================================================================');
  console.log(`ALL TESTS PASSED! (${passCount}/${testCount})`);
  console.log('================================================================\n');
}

runComprehensiveAudit().then(() => {
  pool.end();
}).catch((err) => {
  console.error('Fatal suite failure:', err);
  pool.end();
  process.exit(1);
});
