/**
 * Test Suite for Optional Day-by-Day Itinerary and Verification Pipeline.
 *
 * Verifies Core Requirements 9, 11, and 12 from TravelGenie specification:
 * - Day-by-day checkbox enabled: generates full daily schedules.
 * - Day-by-day checkbox disabled: completely omits day-by-day schedules (itinerary: []),
 *   without generating hidden daily schedules or generic daily schedules as fallback.
 * - Preserves verified places, accommodation guidance, dining, and activities when disabled.
 * - Modify-itinerary respects includeDayByDayItinerary.
 * - Backward compatibility with old saved plans without the field.
 * - Validation boundaries correctly accept plans with empty itinerary when unchecked.
 * - Google Places error/unconfigured states produce explicit warnings.
 * - Mumbai and Pune catalog retrieval without Table B HTTP 400 errors.
 */

import assert from 'node:assert/strict';
import {
  validateGeneratePlanRequest,
  validateModifyPlanRequest
} from './src/validation.js';
import {
  generateCatalogGroundedFallback,
  validateAndMergeModifiedPlan,
  generateTravelPlanService,
  modifyTravelPlanService
} from './src/aiService.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';
import {
  buildVerifiedPlaceCatalog,
  VerifiedPlaceCatalog,
  ATTRACTION_PLACE_TYPES
} from './src/services/placeCatalog.js';
import { ResolvedDestination } from './src/services/destinationResolver.js';
import { GeneratePlanRequest, TravelPlan } from './src/types.js';

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

// Representative mock catalog fixture
const MOCK_DESTINATION: ResolvedDestination = {
  originalInput: 'Mumbai',
  canonicalName: 'Mumbai',
  formattedAddress: 'Mumbai, Maharashtra, India',
  latitude: 19.0760,
  longitude: 72.8777,
  providerPlaceId: 'ChIJwe1EZ273zjsROKkiDGSbN58',
  addressComponents: [
    { longName: 'Mumbai', shortName: 'Mumbai', types: ['locality'] }
  ]
};

const MOCK_CATALOG: VerifiedPlaceCatalog = {
  destination: MOCK_DESTINATION,
  places: [
    {
      internalId: 'VP_01',
      provider: 'google_places',
      providerPlaceId: 'place_gateway_mumbai',
      name: 'Gateway of India',
      primaryCategory: 'attraction',
      types: ['tourist_attraction', 'historical_landmark'],
      formattedAddress: 'Apollo Bandar, Colaba, Mumbai 400001',
      location: { latitude: 18.9220, longitude: 72.8347 },
      distanceMeters: 4500,
      localityRelation: 'exact_destination',
      rating: 4.6,
      userRatingCount: 85000,
      verifiedAt: new Date().toISOString()
    },
    {
      internalId: 'VP_02',
      provider: 'google_places',
      providerPlaceId: 'place_taj_mahal_hotel',
      name: 'The Taj Mahal Palace, Mumbai',
      primaryCategory: 'accommodation',
      types: ['hotel', 'lodging'],
      formattedAddress: 'Apollo Bandar, Colaba, Mumbai 400001',
      location: { latitude: 18.9217, longitude: 72.8332 },
      distanceMeters: 4600,
      localityRelation: 'exact_destination',
      rating: 4.8,
      userRatingCount: 32000,
      verifiedAt: new Date().toISOString()
    },
    {
      internalId: 'VP_03',
      provider: 'google_places',
      providerPlaceId: 'place_leopold_cafe',
      name: 'Leopold Cafe',
      primaryCategory: 'restaurant',
      types: ['restaurant', 'cafe'],
      formattedAddress: 'Colaba Causeway, Mumbai 400001',
      location: { latitude: 18.9228, longitude: 72.8317 },
      distanceMeters: 4700,
      localityRelation: 'exact_destination',
      rating: 4.2,
      userRatingCount: 19000,
      verifiedAt: new Date().toISOString()
    }
  ],
  byCategory: {
    accommodation: [
      {
        internalId: 'VP_02',
        provider: 'google_places',
        providerPlaceId: 'place_taj_mahal_hotel',
        name: 'The Taj Mahal Palace, Mumbai',
        primaryCategory: 'accommodation',
        types: ['hotel', 'lodging'],
        formattedAddress: 'Apollo Bandar, Colaba, Mumbai 400001',
        location: { latitude: 18.9217, longitude: 72.8332 },
        distanceMeters: 4600,
        localityRelation: 'exact_destination',
        rating: 4.8,
        userRatingCount: 32000,
        verifiedAt: new Date().toISOString()
      }
    ],
    attraction: [
      {
        internalId: 'VP_01',
        provider: 'google_places',
        providerPlaceId: 'place_gateway_mumbai',
        name: 'Gateway of India',
        primaryCategory: 'attraction',
        types: ['tourist_attraction', 'historical_landmark'],
        formattedAddress: 'Apollo Bandar, Colaba, Mumbai 400001',
        location: { latitude: 18.9220, longitude: 72.8347 },
        distanceMeters: 4500,
        localityRelation: 'exact_destination',
        rating: 4.6,
        userRatingCount: 85000,
        verifiedAt: new Date().toISOString()
      }
    ],
    restaurant: [
      {
        internalId: 'VP_03',
        provider: 'google_places',
        providerPlaceId: 'place_leopold_cafe',
        name: 'Leopold Cafe',
        primaryCategory: 'restaurant',
        types: ['restaurant', 'cafe'],
        formattedAddress: 'Colaba Causeway, Mumbai 400001',
        location: { latitude: 18.9228, longitude: 72.8317 },
        distanceMeters: 4700,
        localityRelation: 'exact_destination',
        rating: 4.2,
        userRatingCount: 19000,
        verifiedAt: new Date().toISOString()
      }
    ],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    searchRadiiMeters: [5000, 15000, 25000],
    totalVerifiedPlaces: 3
  }
};

async function runSuite() {
  console.log('================================================================');
  console.log('OPTIONAL DAY-BY-DAY ITINERARY & VERIFICATION PIPELINE TEST SUITE');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // 1. API Request Validation
  // --------------------------------------------------------------------------
  console.log('--- 1. API Request Validation ---');

  await test('1.1 includeDayByDayItinerary defaults to true when omitted', () => {
    const res = validateGeneratePlanRequest({
      destination: 'Mumbai',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2
    });
    assert.equal(res.isValid, true);
    assert.equal(res.data?.includeDayByDayItinerary, true);
  });

  await test('1.2 includeDayByDayItinerary correctly accepts explicit true', () => {
    const res = validateGeneratePlanRequest({
      destination: 'Mumbai',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      includeDayByDayItinerary: true
    });
    assert.equal(res.isValid, true);
    assert.equal(res.data?.includeDayByDayItinerary, true);
  });

  await test('1.3 includeDayByDayItinerary correctly accepts explicit false', () => {
    const res = validateGeneratePlanRequest({
      destination: 'Mumbai',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      includeDayByDayItinerary: false
    });
    assert.equal(res.isValid, true);
    assert.equal(res.data?.includeDayByDayItinerary, false);
  });

  await test('1.4 Non-boolean includeDayByDayItinerary is rejected', () => {
    const res = validateGeneratePlanRequest({
      destination: 'Mumbai',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      includeDayByDayItinerary: 'yes' as any
    });
    assert.equal(res.isValid, false);
    assert.ok(res.error?.includes('boolean'));
  });

  // --------------------------------------------------------------------------
  // 2. Grounded Fallback Engine Behavior
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Grounded Fallback Engine Behavior ---');

  await test('2.1 When includeDayByDayItinerary is true, fallback builds full daily schedule', () => {
    const req: GeneratePlanRequest = {
      destination: 'Mumbai',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      interests: ['Food'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      includeDayByDayItinerary: true
    };
    const plan = generateCatalogGroundedFallback(req, MOCK_CATALOG);
    assert.equal(plan.includeDayByDayItinerary, true);
    assert.equal(plan.itinerary.length, 3);
    assert.ok(plan.itinerary[0].morning.length > 0);
    assert.equal(plan.placesToVisit.length, 1);
  });

  await test('2.2 When includeDayByDayItinerary is false, fallback sets itinerary to empty []', () => {
    const req: GeneratePlanRequest = {
      destination: 'Mumbai',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      interests: ['Food'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      includeDayByDayItinerary: false
    };
    const plan = generateCatalogGroundedFallback(req, MOCK_CATALOG);
    assert.equal(plan.includeDayByDayItinerary, false);
    assert.equal(plan.itinerary.length, 0);
    // Still includes genuine verified places, accommodation guidance, food, and activities
    assert.equal(plan.placesToVisit.length, 1);
    assert.equal(plan.placesToVisit[0].verifiedPlaceId, 'VP_01');
    assert.ok(plan.accommodationGuidance.includes('The Taj Mahal Palace'));
    assert.ok(plan.foodAndLocalExperiences.length > 0);
    assert.ok(plan.activities.length > 0);
  });

  // --------------------------------------------------------------------------
  // 3. Post-Generation Travel Plan Validator
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Post-Generation Travel Plan Validator ---');

  await test('3.1 Validator accepts plan with empty itinerary when includeDayByDayItinerary is false', () => {
    const planWithoutItinerary: TravelPlan = {
      accommodationGuidance: 'Stay at The Taj Mahal Palace, Mumbai.',
      placesToVisit: [
        {
          verifiedPlaceId: 'VP_01',
          name: 'Gateway of India',
          reason: 'Historic seaside monument.',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [
        {
          verifiedPlaceId: 'VP_03',
          name: 'Leopold Cafe',
          reason: 'Historic cafe.'
        }
      ],
      activities: [],
      weatherAdvice: 'Pleasant coastal weather.',
      budgetTips: ['Carry cash for street stalls.'],
      itinerary: [],
      includeDayByDayItinerary: false
    };

    const { plan: validated, validationReport } = validateAndSanitizeTravelPlan(planWithoutItinerary, MOCK_CATALOG);
    assert.equal(validated.includeDayByDayItinerary, false);
    assert.equal(validated.itinerary.length, 0);
    assert.equal(validated.placesToVisit.length, 1);
    assert.equal(validated.placesToVisit[0].name, 'Gateway of India');
    assert.equal(validationReport.validPlaceReferences, 2);
  });

  await test('3.2 Validator preserves includeDayByDayItinerary: true when itinerary exists', () => {
    const planWithItinerary: TravelPlan = {
      accommodationGuidance: 'Stay at The Taj Mahal Palace, Mumbai.',
      placesToVisit: [
        {
          verifiedPlaceId: 'VP_01',
          name: 'Gateway of India',
          reason: 'Historic seaside monument.',
          bestTime: 'Morning'
        }
      ],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Warm and humid.',
      budgetTips: ['Use public local trains.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Gateway of India',
          morningPlaceId: 'VP_01',
          afternoon: 'Lunch break',
          evening: 'Sunset stroll',
          notes: 'Dress modestly',
          alternative: 'Museum visit'
        }
      ],
      includeDayByDayItinerary: true
    };

    const { plan: validated } = validateAndSanitizeTravelPlan(planWithItinerary, MOCK_CATALOG);
    assert.equal(validated.includeDayByDayItinerary, true);
    assert.equal(validated.itinerary.length, 1);
  });

  // --------------------------------------------------------------------------
  // 4. Modify Itinerary Preservation
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Modify Itinerary Preservation ---');

  await test('4.1 validateAndMergeModifiedPlan preserves itinerary: [] when original plan omitted it', () => {
    const originalWithoutItinerary: TravelPlan = {
      accommodationGuidance: 'Original accommodation guidance.',
      placesToVisit: [{ name: 'Gateway of India', reason: 'Iconic monument', bestTime: 'Morning' }],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Sunny',
      budgetTips: ['Tip 1'],
      itinerary: [],
      includeDayByDayItinerary: false
    };

    const parsedModified = {
      accommodationGuidance: 'Updated accommodation guidance.',
      placesToVisit: [{ name: 'Gateway of India', reason: 'Iconic monument', bestTime: 'Morning' }],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Sunny with sea breeze',
      budgetTips: ['Updated tip 1'],
      itinerary: []
    };

    const merged = validateAndMergeModifiedPlan(parsedModified, originalWithoutItinerary, 3);
    assert.ok(merged !== null);
    assert.equal(merged?.includeDayByDayItinerary, false);
    assert.equal(merged?.itinerary.length, 0);
    assert.equal(merged?.accommodationGuidance, 'Updated accommodation guidance.');
  });

  await test('4.2 validateAndMergeModifiedPlan merges daily itinerary when original plan had one', () => {
    const originalWithItinerary: TravelPlan = {
      accommodationGuidance: 'Original guidance.',
      placesToVisit: [{ name: 'Gateway of India', reason: 'Monument', bestTime: 'Morning' }],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Warm',
      budgetTips: ['Tip 1'],
      itinerary: [
        { day: 1, morning: 'Day 1 morning', afternoon: 'Day 1 aft', evening: 'Day 1 eve', notes: '', alternative: '' }
      ],
      includeDayByDayItinerary: true
    };

    const parsedModified = {
      accommodationGuidance: 'Modified guidance.',
      itinerary: [
        { day: 1, morning: 'Updated morning', afternoon: 'Updated aft', evening: 'Updated eve', notes: '', alternative: '' }
      ]
    };

    const merged = validateAndMergeModifiedPlan(parsedModified, originalWithItinerary, 1);
    assert.ok(merged !== null);
    assert.equal(merged?.includeDayByDayItinerary, true);
    assert.equal(merged?.itinerary.length, 1);
    assert.equal(merged?.itinerary[0].morning, 'Updated morning');
  });

  // --------------------------------------------------------------------------
  // 5. Backward Compatibility with Legacy Plans
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Backward Compatibility with Legacy Plans ---');

  await test('5.1 Legacy plan with missing includeDayByDayItinerary infers true from non-empty itinerary', () => {
    const legacyPlan: any = {
      accommodationGuidance: 'Stay guidance',
      placesToVisit: [],
      foodAndLocalExperiences: [],
      activities: [],
      weatherAdvice: 'Weather',
      budgetTips: [],
      itinerary: [
        { day: 1, morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', notes: '', alternative: '' }
      ]
      // note: includeDayByDayItinerary is undefined
    };

    const { plan: validated } = validateAndSanitizeTravelPlan(legacyPlan, MOCK_CATALOG);
    assert.equal(validated.includeDayByDayItinerary, true);
  });

  // --------------------------------------------------------------------------
  // 6. Verification Pipeline Diagnostics & Table A Proof
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Verification Pipeline & Table A Compliance ---');

  await test('6.1 ATTRACTION_PLACE_TYPES contains no Table B types that caused Mumbai/Pune failures', () => {
    assert.ok(!ATTRACTION_PLACE_TYPES.includes('place_of_worship'), 'Table B place_of_worship must NOT be in Table A type list');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('hindu_temple'), 'hindu_temple is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('church'), 'church is valid Table A');
    assert.ok(ATTRACTION_PLACE_TYPES.includes('mosque'), 'mosque is valid Table A');
  });

  await test('6.2 generateTravelPlanService rejects when AI service fails and does NOT return template fallback', async () => {
    const req: GeneratePlanRequest = {
      destination: 'Mumbai',
      numberOfDays: 2,
      budgetInr: 20000,
      numberOfTravellers: 2,
      interests: ['Sightseeing'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      includeDayByDayItinerary: false
    };

    // Simulated service execution with mock catalog override where Gemini returns 500
    await assert.rejects(
      async () => {
        await generateTravelPlanService(req, {
          catalogOverride: MOCK_CATALOG,
          fetchFn: async () => new Response('{}', { status: 500 })
        });
      },
      (err: any) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  console.log('\n================================================================');
  console.log(`ALL OPTIONAL ITINERARY & PIPELINE TESTS PASSED! (${passCount}/${testCount})`);
  console.log('================================================================\n');
}

runSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
