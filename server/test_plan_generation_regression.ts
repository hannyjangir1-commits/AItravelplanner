/**
 * Comprehensive Regression Suite for Travel Plan Generation, Fallback Engine,
 * and Actionable HTTP Error Differentiation.
 */

import assert from 'node:assert/strict';
import {
  generateTravelPlanService,
  callGemini,
  GEMINI_MODELS,
  redactApiKey
} from './src/aiService.js';
import {
  OsmNoResultsError,
  DestinationAmbiguityError,
  OsmTimeoutError,
  OsmRateLimitError
} from './src/services/destinationResolver.js';
import type { GeneratePlanRequest } from './src/types.js';
import type { VerifiedPlaceCatalog } from './src/services/placeCatalog.js';

const MOCK_MUMBAI_CATALOG: VerifiedPlaceCatalog = {
  destination: {
    originalInput: 'Mumbai',
    canonicalName: 'Mumbai',
    formattedAddress: 'Mumbai, Maharashtra, India',
    latitude: 18.9388,
    longitude: 72.8354,
    addressComponents: [
      { longName: 'Mumbai', shortName: 'Mumbai', types: ['locality'] },
      { longName: 'Maharashtra', shortName: 'MH', types: ['administrative_area_level_1'] },
      { longName: 'India', shortName: 'IN', types: ['country'] }
    ]
  },
  places: [
    {
      internalId: 'VP_01',
      name: 'Gateway of India',
      primaryCategory: 'attraction',
      localityRelation: 'exact_destination',
      distanceMeters: 450,
      latitude: 18.922,
      longitude: 72.8347,
      rating: 4.6,
      providerPlaceId: 'osm:node/101'
    },
    {
      internalId: 'VP_02',
      name: 'The Taj Mahal Palace Hotel',
      primaryCategory: 'accommodation',
      localityRelation: 'exact_destination',
      distanceMeters: 500,
      latitude: 18.9217,
      longitude: 72.8333,
      rating: 4.8,
      providerPlaceId: 'osm:node/102'
    },
    {
      internalId: 'VP_03',
      name: 'Bademiya Kebab Corner',
      primaryCategory: 'restaurant',
      localityRelation: 'exact_destination',
      distanceMeters: 750,
      latitude: 18.923,
      longitude: 72.832,
      rating: 4.2,
      providerPlaceId: 'osm:node/103'
    }
  ],
  byCategory: {
    accommodation: [
      {
        internalId: 'VP_02',
        name: 'The Taj Mahal Palace Hotel',
        primaryCategory: 'accommodation',
        localityRelation: 'exact_destination',
        distanceMeters: 500,
        latitude: 18.9217,
        longitude: 72.8333,
        rating: 4.8,
        providerPlaceId: 'osm:node/102'
      }
    ],
    attraction: [
      {
        internalId: 'VP_01',
        name: 'Gateway of India',
        primaryCategory: 'attraction',
        localityRelation: 'exact_destination',
        distanceMeters: 450,
        latitude: 18.922,
        longitude: 72.8347,
        rating: 4.6,
        providerPlaceId: 'osm:node/101'
      }
    ],
    restaurant: [
      {
        internalId: 'VP_03',
        name: 'Bademiya Kebab Corner',
        primaryCategory: 'restaurant',
        localityRelation: 'exact_destination',
        distanceMeters: 750,
        latitude: 18.923,
        longitude: 72.832,
        rating: 4.2,
        providerPlaceId: 'osm:node/103'
      }
    ],
    activity: [],
    poi: []
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    searchRadiiMeters: [5000, 15000, 25000],
    totalVerifiedPlaces: 3,
    dataSource: 'OpenStreetMap (ODbL)'
  }
};

const SAMPLE_REQ: GeneratePlanRequest = {
  destination: 'Mumbai',
  numberOfDays: 2,
  budgetInr: 25000,
  numberOfTravellers: 2,
  interests: ['History', 'Food'],
  accommodationPreference: 'Moderate',
  activityLevel: 'Moderate',
  includeDayByDayItinerary: true
};

async function runRegressionSuite() {
  console.log('================================================================');
  console.log('TRAVEL PLAN GENERATION & RESILIENCE REGRESSION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  // 1. Successful AI generation with valid Gemini output
  await test('1. Successful generation: Gemini returns valid structured JSON', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'mock_valid_key_for_test';
    try {
    const validAiJson = JSON.stringify({
      accommodationGuidance: 'Stay near Colaba or Fort area.',
      placesToVisit: [
        { verifiedPlaceId: 'VP_01', name: 'Gateway of India', reason: 'Iconic monument', bestTime: 'Morning' }
      ],
      foodAndLocalExperiences: [
        { verifiedPlaceId: 'VP_03', name: 'Bademiya Kebab Corner', reason: 'Iconic street food' }
      ],
      activities: [
        { name: 'Marine Drive Walk', reason: 'Sunset views' }
      ],
      weatherAdvice: 'Warm and humid, carry light cotton clothing.',
      budgetTips: ['Use Mumbai suburban rail or BEST buses for transit.'],
      itinerary: [
        {
          day: 1,
          morning: 'Visit Gateway of India',
          morningPlaceId: 'VP_01',
          afternoon: 'Lunch at Bademiya',
          afternoonPlaceId: 'VP_03',
          evening: 'Colaba Causeway shopping',
          notes: 'Carry cash',
          alternative: 'Museum visit'
        },
        {
          day: 2,
          morning: 'Heritage precinct walk in Fort',
          afternoon: 'Lunch at local cafe',
          evening: 'Marine Drive sunset',
          notes: 'Breezy evening',
          alternative: 'Art gallery'
        }
      ]
    });

    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes('generateContent')) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: validAiJson }] } }]
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const result = await generateTravelPlanService(SAMPLE_REQ, {
      catalogOverride: MOCK_MUMBAI_CATALOG,
      fetchFn: mockFetch
    });

    assert.equal(result.isDemo, false);
    assert.equal(result.plan.itinerary.length, 2);
    assert.equal(result.plan.placesToVisit[0].name, 'Gateway of India');
    assert.equal(result.plan.placesToVisit[0].verificationStatus, 'verified');
    } finally {
      process.env.GEMINI_API_KEY = origKey;
    }
  });

  // 2. Fallback when GEMINI_API_KEY is missing or placeholder
  await test('2. Grounded fallback activates when GEMINI_API_KEY is missing/placeholder', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
      const result = await generateTravelPlanService(SAMPLE_REQ, {
        catalogOverride: MOCK_MUMBAI_CATALOG
      });

      assert.equal(result.isDemo, true);
      assert.ok(result.plan, 'Plan must be returned');
      assert.equal(result.plan.itinerary.length, 2);
      assert.ok(result.plan.placesToVisit.length > 0);
      assert.equal(result.plan.placesToVisit[0].verifiedPlaceId, 'VP_01');
      assert.ok(result.message?.includes('Demo / Fallback mode'));
    } finally {
      process.env.GEMINI_API_KEY = origKey;
    }
  });

  // 3. Rejection when GEMINI_API_KEY is missing and allowFallback is false
  await test('3. Missing GEMINI_API_KEY throws status 503 when allowFallback is false', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = '';
      await assert.rejects(
        async () => {
          await generateTravelPlanService(SAMPLE_REQ, {
            catalogOverride: MOCK_MUMBAI_CATALOG,
            allowFallback: false
          });
        },
        (err: any) => {
          assert.equal(err.statusCode, 503);
          assert.ok(err.message.includes('GEMINI_API_KEY is not configured'));
          return true;
        }
      );
    } finally {
      process.env.GEMINI_API_KEY = origKey;
    }
  });

  // 4. Grounded fallback activates when Gemini encounters 429 quota exhaustion
  await test('4. Grounded fallback activates on Gemini 429 quota exhaustion', async () => {
    const mock429Fetch: typeof fetch = async (url) => {
      if (String(url).includes('generateContent')) {
        return new Response('RESOURCE_EXHAUSTED: You exceeded your current quota.', { status: 429 });
      }
      return new Response('{}', { status: 200 });
    };

    const result = await generateTravelPlanService(SAMPLE_REQ, {
      catalogOverride: MOCK_MUMBAI_CATALOG,
      fetchFn: mock429Fetch
    });

    assert.equal(result.isDemo, true);
    assert.equal(result.plan.itinerary.length, 2);
  });

  // 5. 429 quota throws with statusCode 429 when allowFallback is false
  await test('5. Gemini 429 quota throws statusCode 429 when allowFallback is false', async () => {
    const mock429Fetch: typeof fetch = async (url) => {
      if (String(url).includes('generateContent')) {
        return new Response('RESOURCE_EXHAUSTED: You exceeded your current quota.', { status: 429 });
      }
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      async () => {
        await generateTravelPlanService(SAMPLE_REQ, {
          catalogOverride: MOCK_MUMBAI_CATALOG,
          fetchFn: mock429Fetch,
          allowFallback: false
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 429);
        assert.ok(err.message.includes('quota exceeded') || err.message.includes('rate limited'));
        return true;
      }
    );
  });

  // 6. Grounded fallback activates on Gemini 503 or network timeout
  await test('6. Grounded fallback activates on Gemini 503 overloaded service', async () => {
    const mock503Fetch: typeof fetch = async (url) => {
      if (String(url).includes('generateContent')) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return new Response('{}', { status: 200 });
    };

    const result = await generateTravelPlanService(SAMPLE_REQ, {
      catalogOverride: MOCK_MUMBAI_CATALOG,
      fetchFn: mock503Fetch
    });

    assert.equal(result.isDemo, true);
    assert.ok(result.plan.accommodationGuidance.includes('The Taj Mahal Palace Hotel'));
  });

  // 7. Grounded fallback activates on malformed AI output (unparseable JSON)
  await test('7. Grounded fallback activates when Gemini returns unparseable JSON', async () => {
    const mockMalformedFetch: typeof fetch = async (url) => {
      if (String(url).includes('generateContent')) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'NOT VALID JSON { incomplete' }] } }]
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const result = await generateTravelPlanService(SAMPLE_REQ, {
      catalogOverride: MOCK_MUMBAI_CATALOG,
      fetchFn: mockMalformedFetch
    });

    assert.equal(result.isDemo, true);
    assert.equal(result.plan.itinerary.length, 2);
  });

  // 8. Unknown destination throws DestinationNotFoundError with isClientError and statusCode 400
  await test('8. Unknown destination throws DestinationNotFoundError with statusCode 400 (never falls back to (0,0))', async () => {
    const mockNominatimEmpty: typeof fetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      async () => {
        await generateTravelPlanService({ ...SAMPLE_REQ, destination: 'CompletelyFakeGhostTown999' }, {
          fetchFn: mockNominatimEmpty
        });
      },
      (err: any) => {
        assert.equal(err.name, 'DestinationNotFoundError');
        assert.equal(err.isClientError, true);
        assert.equal(err.statusCode, 400);
        assert.ok(err.message.includes('Unable to locate destination'));
        return true;
      }
    );
  });

  // 9. Destination provider timeout throws DestinationProviderTimeoutError with statusCode 504
  await test('9. Destination provider timeout throws DestinationProviderTimeoutError with statusCode 504', async () => {
    const mockNominatimTimeout: typeof fetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        throw new OsmTimeoutError('Nominatim connection timed out');
      }
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      async () => {
        await generateTravelPlanService(SAMPLE_REQ, {
          fetchFn: mockNominatimTimeout
        });
      },
      (err: any) => {
        assert.equal(err.name, 'DestinationProviderTimeoutError');
        assert.equal(err.isProviderError, true);
        assert.equal(err.statusCode, 504);
        assert.ok(err.message.includes('timed out'));
        return true;
      }
    );
  });

  // 10. Destination provider rate limit throws DestinationProviderRateLimitError with statusCode 503
  await test('10. Destination provider rate limit throws DestinationProviderRateLimitError with statusCode 503', async () => {
    const mockNominatimRateLimit: typeof fetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        throw new OsmRateLimitError();
      }
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      async () => {
        await generateTravelPlanService(SAMPLE_REQ, {
          fetchFn: mockNominatimRateLimit
        });
      },
      (err: any) => {
        assert.equal(err.name, 'DestinationProviderRateLimitError');
        assert.equal(err.isProviderError, true);
        assert.equal(err.statusCode, 503);
        assert.ok(err.message.includes('rate-limited'));
        return true;
      }
    );
  });

  // 11. Model Cascade verification: Retired models are eliminated, active models present
  await test('11. Model cascade contains only active Google Gemini models', async () => {
    assert.equal(GEMINI_MODELS[0], 'gemini-flash-lite-latest', 'Primary model must be fastest active flash-lite');
    assert.ok(GEMINI_MODELS.includes('gemini-flash-lite-latest'));
    assert.ok(GEMINI_MODELS.includes('gemini-3.5-flash-lite'));
    assert.ok(GEMINI_MODELS.includes('gemini-3-flash-preview'));
    assert.ok(GEMINI_MODELS.includes('gemini-3.8-flash'));
    assert.ok(GEMINI_MODELS.includes('gemini-3.5-flash'));
    assert.ok(GEMINI_MODELS.includes('gemini-3.6-flash'));
    assert.ok(GEMINI_MODELS.includes('gemini-flash-latest'));
    assert.ok(!(GEMINI_MODELS as readonly string[]).includes('gemini-2.0-flash'), 'gemini-2.0-flash is retired (404)');
    assert.ok(!(GEMINI_MODELS as readonly string[]).includes('gemini-2.5-flash'), 'gemini-2.5-flash is retired (404)');
  });

  // 13. Dynamic GEMINI_MODEL resolution prioritizing configured environment model
  await test('13. Configured GEMINI_MODEL takes immediate priority in model cascade', async () => {
    const prevEnv = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = 'custom-configured-model';
    try {
      let firstAttemptedUrl = '';
      const mockFetch = async (url: any) => {
        if (!firstAttemptedUrl) firstAttemptedUrl = String(url);
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"itinerary": []}' }] } }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };
      await callGemini('sys', 'user', { fetchFn: mockFetch as any });
      assert.ok(firstAttemptedUrl.includes('custom-configured-model'), 'Configured model must be attempted first');
    } finally {
      if (prevEnv !== undefined) {
        process.env.GEMINI_MODEL = prevEnv;
      } else {
        delete process.env.GEMINI_MODEL;
      }
    }
  });

  // 14. Actionable cascade diagnostics are recorded for model attempt failures
  await test('14. Actionable diagnostics record phase, status, and category on failure', async () => {
    const prevEnv = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    try {
      const mockFetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('gemini-flash-lite-latest')) {
          return new Response(
            JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Daily limit exceeded' } }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"itinerary": []}' }] } }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await callGemini('sys', 'user', { fetchFn: mockFetch as any });
      assert.ok(res.metrics.attempts && res.metrics.attempts.length > 0, 'Diagnostics attempts array must be present');
      const firstDiag = res.metrics.attempts[0];
      assert.equal(firstDiag.model, 'gemini-flash-lite-latest');
      assert.equal(firstDiag.errorCategory, 'quota_exhausted');
      assert.equal(firstDiag.status, 429);
    } finally {
      if (prevEnv !== undefined) {
        process.env.GEMINI_MODEL = prevEnv;
      } else {
        delete process.env.GEMINI_MODEL;
      }
    }
  });

  // 12. Credentials and secrets are never exposed in logs or errors
  await test('12. API keys are completely redacted from all error messages and logs', async () => {
    const secretKey = 'AQ.SecretApiKey1234567890TestKey';
    const testMsg = `Error connecting to https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview?key=${secretKey}`;
    const sanitized = redactApiKey(testMsg, secretKey);
    assert.ok(!sanitized.includes(secretKey), 'Secret key must be redacted');
    assert.ok(sanitized.includes('[REDACTED_API_KEY]'));
  });

  console.log('\n================================================================');
  console.log(`ALL REGRESSION TESTS PASSED! (${passed}/${total})`);
  console.log('================================================================\n');
}

runRegressionSuite().catch((err) => {
  console.error('\nRegression suite failed:', err);
  process.exit(1);
});
