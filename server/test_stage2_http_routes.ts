/**
 * TravelGenie — Stage 2 HTTP Routes & End-to-End API Integration Suite
 *
 * Runs full HTTP requests against live Express server and real PostgreSQL:
 * 1. POST /api/auth/signup (case normalization, unique constraint enforcement)
 * 2. POST /api/auth/signin (case-insensitive signin, cookie issuance)
 * 3. PATCH /api/auth/profile (strict field validation, immutable field rejection, CSRF check)
 * 4. POST /api/modify-travel-plan (itinerary modification persistence, ownership verification)
 * 5. GET /api/travel-plans and /api/travel-plans/:id (data isolation)
 * 6. DELETE /api/travel-plans/:id (ownership verification and lifecycle removal)
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from './src/index.js';
import { pool } from './src/db.js';
import { runStartupMigrations } from './src/db/init.js';
import { saveTravelPlan, updateSavedTravelPlan } from './src/db/travelPlans.js';

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

interface CookieJar {
  authCookie?: string;
  csrfCookie?: string;
  csrfToken?: string;
}

function parseCookies(response: Response, jar: CookieJar) {
  const setCookieHeaders = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];

  for (const header of setCookieHeaders) {
    if (!header) continue;
    const authMatch = header.match(/travelgenie_auth=([^;]+)/);
    if (authMatch) jar.authCookie = authMatch[1];

    const csrfMatch = header.match(/travelgenie_csrf=([^;]+)/);
    if (csrfMatch) {
      jar.csrfCookie = csrfMatch[1];
      jar.csrfToken = csrfMatch[1];
    }
  }
}

function getHeaders(jar: CookieJar, includeCsrf = true): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const cookies: string[] = [];
  if (jar.authCookie) cookies.push(`travelgenie_auth=${jar.authCookie}`);
  if (jar.csrfCookie) cookies.push(`travelgenie_csrf=${jar.csrfCookie}`);

  if (cookies.length > 0) {
    headers['Cookie'] = cookies.join('; ');
  }

  if (includeCsrf && jar.csrfToken) {
    headers['X-CSRF-Token'] = jar.csrfToken;
  }

  return headers;
}

async function runHttpRoutesSuite() {
  console.log('\n======================================================');
  console.log('TravelGenie — Stage 2 HTTP Routes Integration Suite');
  console.log('======================================================\n');

  await runStartupMigrations();

  // Start Express on an ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`Test HTTP server listening on ${baseUrl}`);

  const userSuffix = Math.random().toString(36).substring(2, 8);
  const rawUsernameBob = `TravelBob_${userSuffix}`;
  const rawUsernameCharlie = `TravelCharlie_${userSuffix}`;
  const testPassword = 'Password123!SafeScrypt';

  const jarBob: CookieJar = {};
  const jarCharlie: CookieJar = {};

  try {
    // -------------------------------------------------------------------------
    // 1. Signup & Signin Flow
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Auth Routes: Normalization & Uniqueness ---');

    // First make a GET request to seed CSRF cookie
    const initRes = await fetch(`${baseUrl}/api/auth/csrf`);
    parseCookies(initRes, jarBob);

    await test('H1. POST /api/auth/signup normalizes username and sets cookies', async () => {
      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: getHeaders(jarBob),
        body: JSON.stringify({
          username: rawUsernameBob,
          password: testPassword
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.authenticated, true);
      assert.equal(data.user.username, rawUsernameBob.toLowerCase());
      parseCookies(res, jarBob);
      assert.ok(jarBob.authCookie, 'Auth cookie must be set on signup');
    });

    await test('H2. POST /api/auth/signup rejects duplicate username with different case', async () => {
      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: rawUsernameBob.toUpperCase(),
          password: testPassword
        })
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.match(data.error, /Username is already taken/);
    });

    await test('H3. POST /api/auth/signin succeeds with uppercase query', async () => {
      const res = await fetch(`${baseUrl}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: rawUsernameBob.toUpperCase(),
          password: testPassword
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.authenticated, true);
      assert.equal(data.user.username, rawUsernameBob.toLowerCase());
    });

    // Sign up Charlie for cross-user isolation tests
    const charlieRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: rawUsernameCharlie,
        password: testPassword
      })
    });
    assert.equal(charlieRes.status, 201);
    parseCookies(charlieRes, jarCharlie);

    // -------------------------------------------------------------------------
    // 2. Profile Validation & Persistence Routes (Task C)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Profile Routes: Validation & CSRF ---');

    await test('H4. PATCH /api/auth/profile without CSRF token returns 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PATCH',
        headers: getHeaders(jarBob, false), // exclude CSRF header
        body: JSON.stringify({ name: 'Bob Traveler', place: 'Kochi' })
      });

      assert.equal(res.status, 403);
    });

    await test('H5. PATCH /api/auth/profile with unknown fields returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PATCH',
        headers: getHeaders(jarBob),
        body: JSON.stringify({ name: 'Bob Traveler', hackerAttribute: 'malicious' })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /Field 'hackerAttribute' is not allowed/);
    });

    await test('H6. PATCH /api/auth/profile with immutable fields returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PATCH',
        headers: getHeaders(jarBob),
        body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', name: 'Bob' })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /Field 'id' is not allowed/);
    });

    await test('H7. PATCH /api/auth/profile with oversized value returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PATCH',
        headers: getHeaders(jarBob),
        body: JSON.stringify({ name: 'A'.repeat(101) })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /must not exceed 100 characters/);
    });

    await test('H8. PATCH /api/auth/profile with valid payload updates and persists', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PATCH',
        headers: getHeaders(jarBob),
        body: JSON.stringify({ name: 'Bob Explorer', place: 'Kochi' })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.user.name, 'Bob Explorer');
      assert.equal(data.user.place, 'Kochi');

      // GET /api/auth/me verification
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });
      assert.equal(meRes.status, 200);
      const meData = await meRes.json();
      assert.equal(meData.user.name, 'Bob Explorer');
      assert.equal(meData.user.place, 'Kochi');
    });

    // -------------------------------------------------------------------------
    // 3. Travel Plan Endpoints & Modification Persistence (Task A, F, G)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Travel Plan Routes: Persistence & Isolation ---');

    let bobPlanId: string;
    const isLiveAi = process.env.RUN_LIVE_AI_TESTS === 'true';

    // Retrieve Bob's verified user ID from PostgreSQL
    const bobUserRow = await pool.query('SELECT id FROM users WHERE username = $1', [rawUsernameBob.toLowerCase()]);
    const bobUserId = bobUserRow.rows[0].id;

    await test('H9. POST /api/generate-travel-plan saves to PostgreSQL and returns ID', async () => {
      if (isLiveAi) {
        const res = await fetch(`${baseUrl}/api/generate-travel-plan`, {
          method: 'POST',
          headers: getHeaders(jarBob),
          body: JSON.stringify({
            destination: 'Agra',
            numberOfDays: 1,
            budgetInr: 10000,
            numberOfTravellers: 1,
            interests: ['Monument', 'Heritage'],
            accommodationPreference: 'Budget',
            activityLevel: 'Moderate'
          })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.id, 'Response must return database saved plan ID');
        bobPlanId = data.id;
      } else {
        // Deterministic local integration test: seeds travel_plans in PostgreSQL without consuming external Gemini quota
        const seeded = await saveTravelPlan(
          bobUserId,
          {
            destination: 'Agra',
            numberOfDays: 1,
            budgetInr: 10000,
            numberOfTravellers: 1,
            interests: ['Monument', 'Heritage'],
            accommodationPreference: 'Budget',
            activityLevel: 'Moderate'
          },
          {
            accommodationGuidance: 'Near Taj Ganj heritage area',
            placesToVisit: [{ name: 'Taj Mahal', reason: 'Historic monument', bestTime: 'Morning' }],
            foodAndLocalExperiences: [{ name: 'Petha', reason: 'Local delicacy' }],
            activities: [{ name: 'Heritage walk', reason: 'Photography' }],
            weatherAdvice: 'Mild seasonal weather',
            budgetTips: ['Book tickets in advance'],
            itinerary: [{
              day: 1,
              morning: 'Taj Mahal',
              afternoon: 'Agra Fort',
              evening: 'Mehtab Bagh sunset',
              notes: 'Carry valid ID',
              alternative: 'Local bazaars'
            }],
            includeDayByDayItinerary: true,
            generatedAt: new Date().toISOString()
          }
        );
        assert.ok(seeded.id, 'Database saved plan ID must be returned');
        bobPlanId = seeded.id;
      }
    });

    await test('H10. GET /api/travel-plans returns saved itinerary in history list', async () => {
      const res = await fetch(`${baseUrl}/api/travel-plans`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.itineraries));
      const found = data.itineraries.find((it: any) => it.id === bobPlanId);
      assert.ok(found, 'Generated plan must be present in history');
      assert.equal(found.destination, 'Agra');
    });

    await test('H11. Data isolation: Charlie cannot view Bob plan by ID', async () => {
      const res = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'GET',
        headers: getHeaders(jarCharlie)
      });

      assert.equal(res.status, 404, 'Must return 404 for unowned itinerary');
    });

    await test('H12. POST /api/modify-travel-plan with itineraryId persists update to PostgreSQL', async () => {
      // First fetch Bob's full plan
      const planRes = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });
      const planData = await planRes.json();
      const currentPlan = planData.itinerary.plan;

      if (isLiveAi) {
        const modifyRes = await fetch(`${baseUrl}/api/modify-travel-plan`, {
          method: 'POST',
          headers: getHeaders(jarBob),
          body: JSON.stringify({
            originalDetails: {
              destination: 'Agra',
              numberOfDays: 1,
              budgetInr: 10000,
              numberOfTravellers: 1,
              interests: ['Monument'],
              accommodationPreference: 'Budget',
              activityLevel: 'Moderate'
            },
            currentPlan,
            modificationRequest: 'Add early morning sunrise photography tips for Taj Mahal',
            itineraryId: bobPlanId
          })
        });

        assert.equal(modifyRes.status, 200);
        const modData = await modifyRes.json();
        assert.equal(modData.success, true);
        assert.equal(modData.id, bobPlanId);
        assert.ok(modData.updatedAt);
      } else {
        // Deterministic persistence verification without external AI quota
        const updated = await updateSavedTravelPlan(bobPlanId, bobUserId, {
          ...currentPlan,
          budgetTips: [...(currentPlan.budgetTips || []), 'Early morning sunrise photography tips for Taj Mahal']
        });
        assert.ok(updated);
        assert.equal(updated.id, bobPlanId);
      }

      // Fresh read to verify persistence in PostgreSQL
      const verifyRes = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });
      assert.equal(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.ok(verifyData.itinerary.updatedAt);
    });

    await test('H13. POST /api/modify-travel-plan rejects modification of unowned itineraryId', async () => {
      const planRes = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });
      const planData = await planRes.json();

      const hostileModifyRes = await fetch(`${baseUrl}/api/modify-travel-plan`, {
        method: 'POST',
        headers: getHeaders(jarCharlie), // Charlie tries to modify Bob's plan
        body: JSON.stringify({
          originalDetails: {
            destination: 'Agra',
            numberOfDays: 1,
            budgetInr: 10000,
            numberOfTravellers: 1,
            interests: ['Monument'],
            accommodationPreference: 'Budget',
            activityLevel: 'Moderate'
          },
          currentPlan: planData.itinerary.plan,
          modificationRequest: 'Malicious modification request',
          itineraryId: bobPlanId
        })
      });

      assert.equal(hostileModifyRes.status, 404);
      const errData = await hostileModifyRes.json();
      assert.match(errData.error, /does not exist or does not belong to your account/);
    });

    await test('H14. DELETE /api/travel-plans/:id rejects deletion by another user', async () => {
      const res = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'DELETE',
        headers: getHeaders(jarCharlie)
      });

      assert.equal(res.status, 404);
    });

    await test('H15. DELETE /api/travel-plans/:id deletes plan and removes it from history', async () => {
      const res = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'DELETE',
        headers: getHeaders(jarBob)
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verify plan is gone
      const verifyRes = await fetch(`${baseUrl}/api/travel-plans/${bobPlanId}`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });
      assert.equal(verifyRes.status, 404);

      // Verify history list is empty
      const historyRes = await fetch(`${baseUrl}/api/travel-plans`, {
        method: 'GET',
        headers: getHeaders(jarBob)
      });
      const histData = await historyRes.json();
      const stillPresent = histData.itineraries.some((it: any) => it.id === bobPlanId);
      assert.equal(stillPresent, false);
    });

    // Cleanup test users from DB
    await pool.query('DELETE FROM users WHERE username IN ($1, $2)', [
      rawUsernameBob.toLowerCase(),
      rawUsernameCharlie.toLowerCase()
    ]);
  } finally {
    server.close();
  }

  console.log('\n======================================================');
  console.log(`All Stage 2 HTTP Route Tests Passed! (${passed}/${total})`);
  console.log('======================================================\n');
}

runHttpRoutesSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nHTTP Suite Failure:', err);
    process.exit(1);
  });
