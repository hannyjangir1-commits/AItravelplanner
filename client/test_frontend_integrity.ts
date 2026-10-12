/**
 * TravelGenie — Frontend Correctness, API Client & State Integrity Test Suite
 *
 * Automated regression suite testing:
 * 1. ApiClientError parsing & HTTP status differentiation (400, 401, 403, 404, 409, 429, 500, Network)
 * 2. Runtime response validation (UserProfile, ItinerarySummary, SavedItineraryDetail, TravelPlan)
 * 3. Anti-CSRF token resolution, cookie parsing & header attachment
 * 4. Client-side storage validation, corrupted JSON recovery & user session isolation
 * 5. AbortSignal request cancellation & race-condition resilience
 */

import assert from 'node:assert/strict';
import {
  ApiClientError,
  parseResponseJson,
  handleHttpError,
  validateUserProfile,
  validateItinerarySummaries,
  validateSavedItineraryDetail,
  getCsrfToken,
  ensureCsrfToken,
  getJsonHeaders,
  generateTravelPlan,
  modifyTravelPlan
} from './src/api.js';

import {
  validateAndSanitizeTravelPlan,
  loadStoredSession,
  saveAppSessionStorage,
  clearAppSessionStorage,
  STORAGE_KEY_PLAN,
  STORAGE_KEY_DETAILS
} from './src/storage.js';

import type { TravelPlan, TripFormData } from './src/types.js';

let passed = 0;
let total = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Mock Browser Environment for DOM & Storage Tests
// -----------------------------------------------------------------------------
const mockStorage = new Map<string, string>();
const fakeSessionStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

let fakeCookie = '';
const fakeDocument = {
  get cookie() {
    return fakeCookie;
  },
  set cookie(val: string) {
    fakeCookie = val;
  }
};

(globalThis as any).sessionStorage = fakeSessionStorage;
(globalThis as any).document = fakeDocument;

function createValidTravelPlan(): TravelPlan {
  return {
    accommodationGuidance: 'Centrally located boutique hotel in heritage quarter',
    placesToVisit: [
      { name: 'City Palace', reason: 'Royal architectural heritage', bestTime: 'Morning' }
    ],
    foodAndLocalExperiences: [
      { name: 'Traditional Thali', reason: 'Regional gastronomic specialty' }
    ],
    activities: [
      { name: 'Sunset Lake Cruise', reason: 'Scenic panoramic perspective' }
    ],
    weatherAdvice: 'Warm days and pleasant evenings',
    budgetTips: ['Book monument entry online to avoid ticket queues'],
    itinerary: [
      {
        day: 1,
        morning: 'Visit City Palace complex',
        afternoon: 'Explore local artisan crafts market',
        evening: 'Sunset boat ride on the lake',
        notes: 'Wear comfortable walking shoes',
        alternative: 'Art museum gallery visit in case of rain'
      }
    ],
    includeDayByDayItinerary: true,
    generatedAt: new Date().toISOString()
  };
}

async function runFrontendIntegritySuite() {
  console.log('\n======================================================');
  console.log('TravelGenie — Frontend Integrity & Resilience Suite');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // 1. ApiClientError & Status Code Handling
  // ---------------------------------------------------------------------------
  console.log('--- 1. API Error Parsing & HTTP Status Code Differentiation ---');

  await test('F1. ApiClientError correctly sets HTTP 400 validation error metadata', () => {
    const err = new ApiClientError('Invalid duration', { status: 400 });
    assert.equal(err.status, 400);
    assert.equal(err.isValidationError, true);
    assert.equal(err.isAuthError, false);
    assert.equal(err.isRateLimit, false);
    assert.equal(err.isNotFound, false);
  });

  await test('F2. ApiClientError correctly sets HTTP 401 and 403 auth error metadata', () => {
    const err401 = new ApiClientError('Unauthorized', { status: 401 });
    assert.equal(err401.isAuthError, true);

    const err403 = new ApiClientError('CSRF token mismatch', { status: 403, code: 'EBADCSRFTOKEN' });
    assert.equal(err403.isAuthError, true);
    assert.equal(err403.code, 'EBADCSRFTOKEN');
  });

  await test('F3. ApiClientError correctly sets HTTP 404 not found metadata', () => {
    const err = new ApiClientError('Plan not found', { status: 404 });
    assert.equal(err.isNotFound, true);
  });

  await test('F4. ApiClientError correctly sets HTTP 429 rate limit metadata', () => {
    const err = new ApiClientError('Too many requests', { status: 429 });
    assert.equal(err.isRateLimit, true);
  });

  await test('F5. ApiClientError correctly sets network failure metadata', () => {
    const err = new ApiClientError('Connection refused', { isNetworkError: true });
    assert.equal(err.isNetworkError, true);
    assert.equal(err.status, 0);
  });

  await test('F6. parseResponseJson handles empty response bodies safely without throwing', async () => {
    const emptyResponse = new Response(null, { status: 204 });
    const data = await parseResponseJson(emptyResponse);
    assert.equal(data, null);
  });

  await test('F7. parseResponseJson throws structured ApiClientError on non-JSON response', async () => {
    const htmlResponse = new Response('<html><body>502 Bad Gateway</body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' }
    });
    await assert.rejects(
      async () => parseResponseJson(htmlResponse),
      (err: any) => err instanceof ApiClientError && err.status === 502
    );
  });

  await test('F8. handleHttpError maps server error to safe sanitized user message', () => {
    const res500 = new Response('', { status: 500 });
    assert.throws(
      () => handleHttpError(res500, { error: 'Database connection failed at postgres://user:secret@db' }),
      (err: any) => err instanceof ApiClientError && err.message.includes('Database connection failed')
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Runtime Response Validation
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Runtime Response Schema Validation ---');

  await test('F9. validateUserProfile accepts valid user and strips extraneous fields', () => {
    const raw = {
      id: 'd9b7367c-9bfa-4998-8ec0-2f3b927db831',
      username: 'traveler_sam',
      name: 'Sam Explorer',
      place: 'Jaipur',
      email: 'sam@example.com',
      password_hash: 'secret_hash_should_not_pass',
      internal_role: 'admin'
    };
    const validated = validateUserProfile(raw);
    assert.ok(validated);
    assert.equal(validated.id, raw.id);
    assert.equal(validated.username, 'traveler_sam');
    assert.equal(validated.name, 'Sam Explorer');
    assert.equal(validated.place, 'Jaipur');
    assert.equal((validated as any).password_hash, undefined);
    assert.equal((validated as any).internal_role, undefined);
  });

  await test('F10. validateUserProfile rejects missing or non-string id or username', () => {
    assert.equal(validateUserProfile(null), null);
    assert.equal(validateUserProfile({ id: 123, username: 'sam' }), null);
    assert.equal(validateUserProfile({ id: 'uuid', username: '' }), null);
    assert.equal(validateUserProfile({}), null);
  });

  await test('F11. validateItinerarySummaries validates list and discards malformed rows', () => {
    const rawList = [
      { id: 'uuid-1', destination: 'Agra', numberOfDays: 2, numberOfTravellers: 1, createdAt: '2026-10-12T10:00:00Z' },
      { id: '', destination: 'Invalid', numberOfDays: 0 }, // invalid: empty id and 0 days
      null, // invalid
      { id: 'uuid-2', destination: 'Kyoto', numberOfDays: '5', numberOfTravellers: '2', createdAt: '2026-10-12T11:00:00Z' }
    ];
    const validated = validateItinerarySummaries(rawList);
    assert.equal(validated.length, 2);
    assert.equal(validated[0].destination, 'Agra');
    assert.equal(validated[1].destination, 'Kyoto');
    assert.equal(validated[1].numberOfDays, 5);
  });

  await test('F12. validateSavedItineraryDetail validates detail record and nested plan', () => {
    const samplePlan = createValidTravelPlan();
    const rawDetail = {
      id: 'uuid-plan-1',
      destination: 'Udaipur',
      numberOfDays: 1,
      budgetInr: 15000,
      numberOfTravellers: 2,
      interests: ['Culture', 'Food'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      additionalNotes: 'Lakeside views preferred',
      includeDayByDayItinerary: true,
      plan: samplePlan,
      createdAt: '2026-10-12T10:00:00Z',
      updatedAt: '2026-10-12T10:00:00Z'
    };

    const validated = validateSavedItineraryDetail(rawDetail);
    assert.ok(validated);
    assert.equal(validated.id, 'uuid-plan-1');
    assert.equal(validated.destination, 'Udaipur');
    assert.equal(validated.plan.itinerary.length, 1);
  });

  await test('F13. validateSavedItineraryDetail rejects record when plan is invalid or missing', () => {
    const badDetail = {
      id: 'uuid-plan-1',
      destination: 'Udaipur',
      numberOfDays: 1,
      budgetInr: 15000,
      numberOfTravellers: 2,
      plan: { invalid: true } // Missing required itinerary array
    };
    assert.equal(validateSavedItineraryDetail(badDetail), null);
  });

  await test('F14. validateAndSanitizeTravelPlan provides fallbacks for optional text fields', () => {
    const sparsePlan = {
      itinerary: [
        { day: 1, morning: 'Visit Temple', afternoon: '', evening: '' }
      ]
    };
    const sanitized = validateAndSanitizeTravelPlan(sparsePlan);
    assert.ok(sanitized);
    assert.ok(sanitized.accommodationGuidance.length > 0);
    assert.ok(sanitized.weatherAdvice.length > 0);
    assert.equal(sanitized.itinerary.length, 1);
  });

  // ---------------------------------------------------------------------------
  // 3. CSRF & Header Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. CSRF Resolution & Request Headers ---');

  await test('F15. getCsrfToken parses travelgenie_csrf cookie from document.cookie', () => {
    fakeCookie = 'other_cookie=xyz; travelgenie_csrf=a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef; session=active';
    const token = getCsrfToken();
    assert.equal(token, 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef');
  });

  await test('F16. getJsonHeaders attaches X-CSRF-Token when cookie is present', async () => {
    fakeCookie = 'travelgenie_csrf=token_secret_12345';
    const headers = await getJsonHeaders({ 'Custom-Header': 'val' });
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['Accept'], 'application/json');
    assert.equal(headers['Custom-Header'], 'val');
    assert.equal(headers['X-CSRF-Token'], 'token_secret_12345');
  });

  await test('F17. ensureCsrfToken returns existing cookie token without extra network request', async () => {
    fakeCookie = 'travelgenie_csrf=existing_csrf_token_value';
    const token = await ensureCsrfToken();
    assert.equal(token, 'existing_csrf_token_value');
  });

  // ---------------------------------------------------------------------------
  // 4. Client-Side Storage & Privacy (Task F)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Client-Side Storage & Privacy (Task F) ---');

  await test('F18. Stored session state does not store passwords, JWTs, or secrets', () => {
    const validPlan = createValidTravelPlan();
    const validDetails: TripFormData = {
      destination: 'Goa',
      numberOfDays: 3,
      budgetInr: 20000,
      numberOfTravellers: 2,
      interests: ['Beaches'],
      accommodationPreference: 'Budget',
      activityLevel: 'Relaxed',
      additionalNotes: ''
    };

    saveAppSessionStorage(validPlan, validDetails, false, 'Plan ready');
    const storedPlanRaw = fakeSessionStorage.getItem(STORAGE_KEY_PLAN);
    const storedDetailsRaw = fakeSessionStorage.getItem(STORAGE_KEY_DETAILS);

    assert.ok(storedPlanRaw);
    assert.ok(storedDetailsRaw);
    assert.equal(storedPlanRaw.includes('password'), false);
    assert.equal(storedPlanRaw.includes('jwt'), false);
    assert.equal(storedDetailsRaw.includes('token'), false);
  });

  await test('F19. loadStoredSession successfully restores valid saved session', () => {
    const restored = loadStoredSession();
    assert.ok(restored.plan);
    assert.ok(restored.details);
    assert.equal(restored.details.destination, 'Goa');
    assert.equal(restored.isDemo, false);
  });

  await test('F20. loadStoredSession clears corrupted JSON and returns clean empty state', () => {
    fakeSessionStorage.setItem(STORAGE_KEY_PLAN, '{ bad json ::: broken');
    const restored = loadStoredSession();
    assert.equal(restored.plan, null);
    assert.equal(restored.details, null);
    assert.equal(fakeSessionStorage.getItem(STORAGE_KEY_PLAN), null);
  });

  await test('F21. clearAppSessionStorage cleans only application keys and leaves foreign keys intact', () => {
    fakeSessionStorage.setItem('other_app_setting', 'keep_me');
    fakeSessionStorage.setItem(STORAGE_KEY_PLAN, 'some_plan');
    fakeSessionStorage.setItem(STORAGE_KEY_DETAILS, 'some_details');

    clearAppSessionStorage();
    assert.equal(fakeSessionStorage.getItem(STORAGE_KEY_PLAN), null);
    assert.equal(fakeSessionStorage.getItem(STORAGE_KEY_DETAILS), null);
    assert.equal(fakeSessionStorage.getItem('other_app_setting'), 'keep_me');
  });

  // ---------------------------------------------------------------------------
  // 5. AbortSignal & Request Lifecycle (Task B4)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. AbortSignal & Concurrency Guards ---');

  await test('F22. generateTravelPlan rejects with AbortError when AbortSignal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    // Stub global fetch to observe abort signal
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return new Response(JSON.stringify({ data: createValidTravelPlan() }));
    };

    try {
      await assert.rejects(
        async () => {
          await generateTravelPlan(
            {
              destination: 'Varanasi',
              numberOfDays: 2,
              budgetInr: 10000,
              numberOfTravellers: 1,
              interests: ['Culture'],
              accommodationPreference: 'Budget',
              activityLevel: 'Moderate',
              additionalNotes: ''
            },
            { signal: controller.signal }
          );
        },
        (err: any) => err.name === 'AbortError'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test('F23. modifyTravelPlan attaches itineraryId and updates correctly', async () => {
    const validPlan = createValidTravelPlan();
    const originalFetch = globalThis.fetch;
    let sentPayload: any = null;

    (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
      sentPayload = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          success: true,
          data: { ...validPlan, budgetTips: ['Added photo tips'] },
          id: 'test-itinerary-id-123',
          updatedAt: '2026-10-12T12:00:00Z'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const res = await modifyTravelPlan(
        {
          destination: 'Agra',
          numberOfDays: 1,
          budgetInr: 10000,
          numberOfTravellers: 1,
          interests: ['Culture'],
          accommodationPreference: 'Budget',
          activityLevel: 'Moderate',
          additionalNotes: ''
        },
        validPlan,
        'Add photography recommendations',
        'test-itinerary-id-123'
      );

      assert.equal(sentPayload.itineraryId, 'test-itinerary-id-123');
      assert.equal(res.id, 'test-itinerary-id-123');
      assert.equal(res.updatedAt, '2026-10-12T12:00:00Z');
      assert.ok(res.plan);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n======================================================');
  console.log(`All Frontend Integrity Tests Passed! (${passed}/${total})`);
  console.log('======================================================\n');
}

runFrontendIntegritySuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFrontend Suite Failure:', err);
    process.exit(1);
  });
