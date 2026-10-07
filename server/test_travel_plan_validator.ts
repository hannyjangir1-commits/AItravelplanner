/**
 * Unit tests for Phase 2C — Post-Generation Verified Place Validator.
 *
 * Verifies all 23 required Phase 2C validator rules:
 * 1. Valid verifiedPlaceId passes.
 * 2. Unknown verifiedPlaceId is removed.
 * 3. Gemini name is replaced by authoritative catalog name.
 * 4. Valid itinerary place ID passes.
 * 5. Invalid itinerary place ID is removed.
 * 6. Unknown hotel name is removed.
 * 7. Valid hotel name remains.
 * 8. Unknown restaurant name is removed.
 * 9. Generic food advice remains.
 * 10. Unknown activity venue is removed.
 * 11. Generic activity remains.
 * 12. Unsupported numeric hotel price is removed.
 * 13. Google price level is not converted into INR.
 * 14. Catalog distance overrides Gemini distance.
 * 15. Catalog localityRelation overrides Gemini locality claim.
 * 16. Missing accommodation remains honest.
 * 17. Missing attraction remains honest.
 * 18. Duplicate recommendation entities are handled safely.
 * 19. Gemini-generated unsupported place in free text is sanitized where deterministic.
 * 20. Fallback output is also validated.
 * 21. Modify-plan output is also validated.
 * 22. No fake replacement places are created.
 * 23. Existing valid TravelPlan fields remain intact.
 *
 * All external calls (Google and Gemini) are mocked; zero live API calls are made.
 */

import assert from 'node:assert/strict';
import {
  TravelPlan,
  GeneratePlanRequest,
  ModifyPlanRequest
} from './src/types.js';
import { ResolvedDestination } from './src/services/destinationResolver.js';
import { VerifiedPlaceCatalog } from './src/services/placeCatalog.js';
import {
  validateAndSanitizeTravelPlan
} from './src/services/travelPlanValidator.js';
import {
  generateCatalogGroundedFallback,
  modifyTravelPlanService
} from './src/aiService.js';

// Set mock API key to satisfy callGemini key presence check without making live calls
process.env.GEMINI_API_KEY = 'mock_gemini_api_key_for_validator_test';

let totalTests = 0;
let passedTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof (result as any).then === 'function') {
      await result;
    }
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ============================================================================
// Mock Data Setup
// ============================================================================

const mockDestination: ResolvedDestination = {
  originalInput: 'Chandekasare',
  canonicalName: 'Chandekasare',
  formattedAddress: 'Chandekasare, Ahmednagar, Maharashtra 423601, India',
  latitude: 19.8654,
  longitude: 74.4812,
  providerPlaceId: 'ChIJ_chandekasare_anchor',
  locationType: 'APPROXIMATE',
  addressComponents: [
    { longName: 'Chandekasare', shortName: 'Chandekasare', types: ['locality'] },
    { longName: 'Maharashtra', shortName: 'MH', types: ['administrative_area_level_1'] }
  ]
};

// Rich verified catalog with real places across categories
const mockVerifiedCatalog: VerifiedPlaceCatalog = {
  destination: mockDestination,
  places: [
    {
      internalId: 'VP_01',
      provider: 'google_places',
      providerPlaceId: 'ChIJ_temple_01',
      name: 'Shri Ram Mandir Chandekasare',
      primaryCategory: 'attraction',
      types: ['hindu_temple', 'place_of_worship'],
      formattedAddress: 'Gram Panchayat Road, Chandekasare',
      location: { latitude: 19.8658, longitude: 74.4816 },
      distanceMeters: 250,
      localityRelation: 'exact_destination',
      rating: 4.7,
      userRatingCount: 45,
      googleMapsUri: 'https://maps.google.com/?cid=111',
      websiteUri: null,
      phoneNumber: null,
      openingHours: ['Monday: 6:00 AM - 9:00 PM'],
      priceLevel: null,
      priceStatus: 'PRICE_UNAVAILABLE',
      estimatedPriceInrRange: null,
      verificationTimestamp: '2026-10-08T00:00:00.000Z'
    },
    {
      internalId: 'VP_02',
      provider: 'google_places',
      providerPlaceId: 'ChIJ_rest_01',
      name: 'Hotel Sai Sagar Dining',
      primaryCategory: 'restaurant',
      types: ['restaurant', 'food'],
      formattedAddress: 'Station Road, Chandekasare',
      location: { latitude: 19.8690, longitude: 74.4840 },
      distanceMeters: 600,
      localityRelation: 'exact_destination',
      rating: 4.2,
      userRatingCount: 120,
      googleMapsUri: 'https://maps.google.com/?cid=222',
      websiteUri: null,
      phoneNumber: null,
      openingHours: ['Monday: 8:00 AM - 10:00 PM'],
      priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
      priceStatus: 'PRICE_LEVEL_ONLY',
      estimatedPriceInrRange: null,
      verificationTimestamp: '2026-10-08T00:00:00.000Z'
    },
    {
      internalId: 'VP_03',
      provider: 'google_places',
      providerPlaceId: 'ChIJ_act_01',
      name: 'Kopargaon Riverside Park',
      primaryCategory: 'activity',
      types: ['park', 'tourist_attraction'],
      formattedAddress: 'Godavari Riverbank, Kopargaon',
      location: { latitude: 19.8800, longitude: 74.4900 },
      distanceMeters: 14200,
      localityRelation: 'nearby',
      rating: 4.1,
      userRatingCount: 88,
      googleMapsUri: 'https://maps.google.com/?cid=333',
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null,
      priceStatus: 'PRICE_UNAVAILABLE',
      estimatedPriceInrRange: null,
      verificationTimestamp: '2026-10-08T00:00:00.000Z'
    },
    {
      internalId: 'VP_04',
      provider: 'google_places',
      providerPlaceId: 'ChIJ_hotel_01',
      name: 'Hotel Shirdi Grand Inn',
      primaryCategory: 'accommodation',
      types: ['hotel', 'lodging'],
      formattedAddress: 'Pimpalwadi Road, Shirdi',
      location: { latitude: 19.7700, longitude: 74.4800 },
      distanceMeters: 18500,
      localityRelation: 'nearest_town',
      rating: 4.3,
      userRatingCount: 310,
      googleMapsUri: 'https://maps.google.com/?cid=444',
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: 'PRICE_LEVEL_MODERATE',
      priceStatus: 'PRICE_LEVEL_ONLY',
      estimatedPriceInrRange: null,
      verificationTimestamp: '2026-10-08T00:00:00.000Z'
    },
    {
      internalId: 'VP_05',
      provider: 'google_places',
      providerPlaceId: 'ChIJ_museum_01',
      name: 'Sai Heritage Museum',
      primaryCategory: 'attraction',
      types: ['museum', 'tourist_attraction'],
      formattedAddress: 'Main Road, Shirdi Outskirts',
      location: { latitude: 19.7800, longitude: 74.4850 },
      distanceMeters: 12400,
      localityRelation: 'nearby',
      rating: 4.5,
      userRatingCount: 240,
      googleMapsUri: 'https://maps.google.com/?cid=555',
      websiteUri: null,
      phoneNumber: null,
      openingHours: null,
      priceLevel: null,
      priceStatus: 'PRICE_UNAVAILABLE',
      estimatedPriceInrRange: null,
      verificationTimestamp: '2026-10-08T00:00:00.000Z'
    }
  ],
  byCategory: {
    accommodation: [],
    attraction: [],
    restaurant: [],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: '2026-10-08T00:00:00.000Z',
    searchRadiiMeters: [5000, 15000, 25000],
    totalVerifiedPlaces: 5
  }
};

// Populate categories for mockVerifiedCatalog
mockVerifiedCatalog.byCategory.accommodation = mockVerifiedCatalog.places.filter(p => p.primaryCategory === 'accommodation');
mockVerifiedCatalog.byCategory.attraction = mockVerifiedCatalog.places.filter(p => p.primaryCategory === 'attraction');
mockVerifiedCatalog.byCategory.restaurant = mockVerifiedCatalog.places.filter(p => p.primaryCategory === 'restaurant');
mockVerifiedCatalog.byCategory.activity = mockVerifiedCatalog.places.filter(p => p.primaryCategory === 'activity');

// Truly rural empty catalog: 0 accommodations, 0 attractions
const mockEmptyRuralCatalog: VerifiedPlaceCatalog = {
  destination: mockDestination,
  places: [],
  byCategory: {
    accommodation: [],
    attraction: [],
    restaurant: [],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: '2026-10-08T00:00:00.000Z',
    searchRadiiMeters: [5000, 15000, 25000],
    totalVerifiedPlaces: 0
  }
};

/**
 * Creates a clean baseline travel plan for testing.
 */
function createBaseTravelPlan(): TravelPlan {
  return {
    accommodationGuidance: 'Stay at Hotel Shirdi Grand Inn for comfortable lodging.',
    placesToVisit: [
      {
        verifiedPlaceId: 'VP_01',
        name: 'Shri Ram Mandir Chandekasare',
        reason: 'Historic spiritual landmark',
        bestTime: 'Early morning'
      }
    ],
    foodAndLocalExperiences: [
      {
        verifiedPlaceId: 'VP_02',
        name: 'Hotel Sai Sagar Dining',
        reason: 'Fresh regional Maharashtrian meals'
      }
    ],
    activities: [
      {
        verifiedPlaceId: 'VP_03',
        name: 'Kopargaon Riverside Park',
        reason: 'Evening riverside nature stroll'
      }
    ],
    weatherAdvice: 'Mild sunny days and cool pleasant evenings.',
    budgetTips: [
      'Carry cash for village kiosks.',
      'Auto-rickshaws require upfront negotiation.'
    ],
    itinerary: [
      {
        day: 1,
        morning: 'Visit Shri Ram Mandir Chandekasare and experience the peaceful temple ambiance.',
        morningPlaceId: 'VP_01',
        afternoon: 'Enjoy lunch at Hotel Sai Sagar Dining.',
        afternoonPlaceId: 'VP_02',
        evening: 'Relax at Kopargaon Riverside Park during twilight.',
        eveningPlaceId: 'VP_03',
        notes: 'Wear modest clothing.',
        alternative: 'Rest during hot afternoon hours.'
      }
    ]
  };
}

// ============================================================================
// Main Async Runner
// ============================================================================

async function main() {
  console.log('\n--- 1. Testing Structured Place Reference Validation ---');

  await runTest('1. Valid verifiedPlaceId passes', () => {
    const plan = createBaseTravelPlan();
    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.placesToVisit.length, 1);
    assert.equal(sanitized.placesToVisit[0].verifiedPlaceId, 'VP_01');
    assert.equal(sanitized.placesToVisit[0].name, 'Shri Ram Mandir Chandekasare');
    assert.ok(validationReport.validPlaceReferences >= 1);
  });

  await runTest('2. Unknown verifiedPlaceId is removed', () => {
    const plan = createBaseTravelPlan();
    plan.placesToVisit.push({
      verifiedPlaceId: 'VP_FAKE_99',
      name: 'Hallucinated Chandekasare Fort',
      reason: 'Nonexistent entity',
      bestTime: 'Morning'
    });

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.placesToVisit.length, 1); // Only VP_01 remains
    assert.ok(!sanitized.placesToVisit.some(p => p.verifiedPlaceId === 'VP_FAKE_99'));
    assert.ok(validationReport.removedPlaceReferences >= 1);
  });

  await runTest('3. Gemini name is replaced by authoritative catalog name', () => {
    const plan = createBaseTravelPlan();
    // Gemini changed the name slightly
    plan.placesToVisit[0] = {
      verifiedPlaceId: 'VP_01',
      name: 'Shri Ram Historical Mandir Complex',
      reason: 'Ancient temple',
      bestTime: 'Morning'
    };

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.placesToVisit[0].name, 'Shri Ram Mandir Chandekasare');
    assert.equal(validationReport.correctedPlaceNames, 1);
  });

  console.log('\n--- 2. Testing Itinerary Place ID Validation ---');

  await runTest('4. Valid itinerary place ID passes', () => {
    const plan = createBaseTravelPlan();
    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.itinerary[0].morningPlaceId, 'VP_01');
    assert.equal(sanitized.itinerary[0].afternoonPlaceId, 'VP_02');
    assert.equal(sanitized.itinerary[0].eveningPlaceId, 'VP_03');
  });

  await runTest('5. Invalid itinerary place ID is removed', () => {
    const plan = createBaseTravelPlan();
    plan.itinerary[0].morningPlaceId = 'VP_INVALID_999';

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.itinerary[0].morningPlaceId, undefined);
    assert.ok(validationReport.removedPlaceReferences >= 1);
  });

  console.log('\n--- 3. Testing Accommodation Guidance & Pricing ---');

  await runTest('6. Unknown hotel name is removed', () => {
    const plan = createBaseTravelPlan();
    plan.accommodationGuidance = 'Stay at Chandekasare Royal Palace Resort in the village for a luxury experience.';

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.accommodationGuidance.includes('Chandekasare Royal Palace Resort'));
    assert.ok(validationReport.removedUnsupportedAccommodation >= 1);
  });

  await runTest('7. Valid hotel name remains', () => {
    const plan = createBaseTravelPlan();
    plan.accommodationGuidance = 'Stay at Hotel Shirdi Grand Inn located in the nearest commercial town.';

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(sanitized.accommodationGuidance.includes('Hotel Shirdi Grand Inn'));
  });

  await runTest('12. Unsupported numeric hotel price is removed', () => {
    const plan = createBaseTravelPlan();
    plan.accommodationGuidance = 'Stay at Hotel Shirdi Grand Inn for ₹1,500/night with complimentary breakfast.';

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.accommodationGuidance.includes('₹1,500/night'));
    assert.ok(!sanitized.accommodationGuidance.includes('₹1,500'));
    assert.ok(sanitized.accommodationGuidance.includes('(current accommodation pricing is unavailable)'));
    assert.ok(validationReport.removedUnsupportedPrices >= 1);
  });

  await runTest('13. Google price level is not converted into INR', () => {
    const plan = createBaseTravelPlan();
    plan.accommodationGuidance = 'Budget options range between ₹500–₹1,000 per night based on price tier.';

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.accommodationGuidance.includes('₹500–₹1,000'));
    assert.ok(validationReport.removedUnsupportedPrices >= 1);
  });

  console.log('\n--- 4. Testing Restaurant & Activity Validation ---');

  await runTest('8. Unknown restaurant name is removed', () => {
    const plan = createBaseTravelPlan();
    plan.foodAndLocalExperiences.push({
      name: 'Chandekasare Heritage Kitchen',
      reason: 'Authentic local dishes'
    });

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.foodAndLocalExperiences.some(f => f.name.includes('Chandekasare Heritage Kitchen')));
    assert.ok(validationReport.removedPlaceReferences >= 1);
  });

  await runTest('9. Generic food advice remains', () => {
    const plan = createBaseTravelPlan();
    plan.foodAndLocalExperiences.push({
      name: 'Try local Maharashtrian cuisine',
      reason: 'Sample traditional pitla bhakri and misal pav'
    });

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(sanitized.foodAndLocalExperiences.some(f => f.name === 'Try local Maharashtrian cuisine'));
  });

  await runTest('10. Unknown activity venue is removed', () => {
    const plan = createBaseTravelPlan();
    plan.activities.push({
      name: 'Join the Chandekasare Heritage Village Tour',
      reason: 'Guided historical tour'
    });

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.activities.some(a => a.name.includes('Chandekasare Heritage Village Tour')));
    assert.ok(validationReport.removedPlaceReferences >= 1);
  });

  await runTest('11. Generic activity remains', () => {
    const plan = createBaseTravelPlan();
    plan.activities.push({
      name: 'Take a walk through the surrounding farmland',
      reason: 'Peaceful morning walk along agricultural paths'
    });

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(sanitized.activities.some(a => a.name === 'Take a walk through the surrounding farmland'));
  });

  console.log('\n--- 5. Testing Distance & Locality Alignment ---');

  await runTest('14. Catalog distance overrides Gemini distance', () => {
    const plan = createBaseTravelPlan();
    // VP_05 actual catalog distance is 12.4 km (12400 meters)
    plan.itinerary[0].morning = 'Visit Sai Heritage Museum, located 8 km away from the village center.';
    plan.itinerary[0].morningPlaceId = 'VP_05';

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.itinerary[0].morning.includes('8 km away'));
    assert.ok(sanitized.itinerary[0].morning.includes('12.4 km away'));
  });

  await runTest('15. Catalog localityRelation overrides Gemini locality claim', () => {
    const plan = createBaseTravelPlan();
    // VP_05 localityRelation is 'nearby' (outside Chandekasare)
    plan.itinerary[0].morning = 'Visit Sai Heritage Museum, located inside Chandekasare.';
    plan.itinerary[0].morningPlaceId = 'VP_05';

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.itinerary[0].morning.includes('located inside Chandekasare'));
    assert.ok(sanitized.itinerary[0].morning.includes('located nearby'));
  });

  console.log('\n--- 6. Testing Honesty in Rural Destinations ---');

  await runTest('16. Missing accommodation remains honest', () => {
    const plan = createBaseTravelPlan();
    plan.accommodationGuidance = 'Book rooms at Chandekasare Guest House or Village Inn for ₹1,200/night.';

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockEmptyRuralCatalog);

    assert.equal(sanitized.accommodationGuidance, 'No verified accommodation was found in the searched area.');
    assert.ok(!sanitized.accommodationGuidance.includes('Chandekasare Guest House'));
    assert.ok(!sanitized.accommodationGuidance.includes('₹1,200'));
    assert.ok(validationReport.removedUnsupportedAccommodation >= 1);
  });

  await runTest('17. Missing attraction remains honest', () => {
    const plan = createBaseTravelPlan();
    plan.placesToVisit = [
      {
        name: 'Chandekasare Village Square',
        reason: 'Fictional landmark',
        bestTime: 'Morning'
      },
      {
        name: 'Ancient Chandekasare Fort',
        reason: 'Fictional fort',
        bestTime: 'Afternoon'
      }
    ];

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockEmptyRuralCatalog);

    assert.equal(sanitized.placesToVisit.length, 0);
    assert.ok(validationReport.removedPlaceReferences >= 2);
  });

  console.log('\n--- 7. Testing Deduplication, Free Text, & Schema Integrity ---');

  await runTest('18. Duplicate recommendation entities are handled safely', () => {
    const plan = createBaseTravelPlan();
    plan.placesToVisit.push({
      verifiedPlaceId: 'VP_01',
      name: 'Shri Ram Mandir Chandekasare',
      reason: 'Duplicate entry',
      bestTime: 'Evening'
    });

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.placesToVisit.length, 1);
  });

  await runTest('19. Gemini-generated unsupported place in free text is sanitized where deterministic', () => {
    const plan = createBaseTravelPlan();
    // Free text contains an unverified landmark pattern without any valid place ID
    plan.itinerary[0].morning = 'Visit Chandekasare Village Square for morning tea and local chats.';
    plan.itinerary[0].morningPlaceId = undefined;

    const { plan: sanitized, validationReport } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.ok(!sanitized.itinerary[0].morning.includes('Chandekasare Village Square'));
    assert.ok(sanitized.itinerary[0].morning.includes('Explore the local surroundings'));
    assert.ok(validationReport.removedPlaceReferences >= 1);
  });

  await runTest('20. Fallback output is also validated', () => {
    const request: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 2,
      budgetInr: 10000,
      numberOfTravellers: 2,
      interests: ['Temples'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Relaxed'
    };

    const fallbackPlan = generateCatalogGroundedFallback(request, mockVerifiedCatalog);
    const { plan: sanitizedFallback, validationReport } = validateAndSanitizeTravelPlan(fallbackPlan, mockVerifiedCatalog);

    assert.equal(validationReport.removedPlaceReferences, 0);
    assert.equal(validationReport.removedUnsupportedPrices, 0);
    assert.ok(sanitizedFallback.placesToVisit.length > 0);
  });

  await runTest('21. Modify-plan output is also validated', async () => {
    const originalDetails: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 5000,
      numberOfTravellers: 1,
      interests: ['Sightseeing'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate'
    };

    const currentPlan = createBaseTravelPlan();
    currentPlan.resolvedDestination = mockDestination;
    currentPlan.verifiedPlacesCatalog = mockVerifiedCatalog.places;

    const modifyRequest: ModifyPlanRequest = {
      originalDetails,
      currentPlan,
      modificationRequest: 'Focus more on spiritual places'
    };

    // Mock fetchFn that returns a modified plan containing an invalid place ID
    const mockFetchFn: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      accommodationGuidance: 'Stay at Hotel Shirdi Grand Inn for comfortable lodging.',
                      placesToVisit: [
                        {
                          verifiedPlaceId: 'VP_01',
                          name: 'Shri Ram Mandir Chandekasare',
                          reason: 'Spiritual focus',
                          bestTime: 'Morning'
                        },
                        {
                          verifiedPlaceId: 'VP_FAKE_99',
                          name: 'Fictional Spiritual Center',
                          reason: 'Fake place',
                          bestTime: 'Afternoon'
                        }
                      ],
                      foodAndLocalExperiences: [
                        {
                          verifiedPlaceId: 'VP_02',
                          name: 'Hotel Sai Sagar Dining',
                          reason: 'Lunch'
                        }
                      ],
                      activities: [],
                      weatherAdvice: 'Pleasant weather.',
                      budgetTips: ['Budget friendly.'],
                      itinerary: [
                        {
                          day: 1,
                          morning: 'Morning prayers at temple.',
                          morningPlaceId: 'VP_01',
                          afternoon: 'Rest.',
                          afternoonPlaceId: undefined,
                          evening: 'Stroll.',
                          eveningPlaceId: undefined,
                          notes: 'Modest dress.',
                          alternative: 'Rest.'
                        }
                      ]
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

    const result = await modifyTravelPlanService(modifyRequest, {
      fetchFn: mockFetchFn,
      catalogOverride: mockVerifiedCatalog
    });

    // Verify that VP_FAKE_99 was stripped out by the validator during modification
    assert.ok(result.plan);
    assert.ok(!result.plan.placesToVisit.some(p => p.verifiedPlaceId === 'VP_FAKE_99'));
    assert.equal(result.plan.placesToVisit.length, 1);
    assert.equal(result.plan.placesToVisit[0].verifiedPlaceId, 'VP_01');
  });

  await runTest('22. No fake replacement places are created', () => {
    const plan = createBaseTravelPlan();
    plan.placesToVisit = [
      {
        verifiedPlaceId: 'VP_NONEXISTENT',
        name: 'Invented Place',
        reason: 'Fake',
        bestTime: 'Morning'
      }
    ];

    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    // Array must be empty, not populated with fabricated replacement places
    assert.equal(sanitized.placesToVisit.length, 0);
  });

  await runTest('23. Existing valid TravelPlan fields remain intact', () => {
    const plan = createBaseTravelPlan();
    const { plan: sanitized } = validateAndSanitizeTravelPlan(plan, mockVerifiedCatalog);

    assert.equal(sanitized.weatherAdvice, 'Mild sunny days and cool pleasant evenings.');
    assert.equal(sanitized.budgetTips.length, 2);
    assert.equal(sanitized.itinerary[0].day, 1);
    assert.equal(sanitized.itinerary[0].notes, 'Wear modest clothing.');
    assert.equal(sanitized.itinerary[0].alternative, 'Rest during hot afternoon hours.');
    assert.ok(sanitized.resolvedDestination);
    assert.ok(sanitized.verifiedPlacesCatalog);
  });

  // Summary
  console.log(`\n========================================`);
  console.log(`All Phase 2C Validator Tests Passed! (${passedTests}/${totalTests})`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
