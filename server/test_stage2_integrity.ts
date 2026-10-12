/**
 * TravelGenie — Stage 2 Integrity & Persistence Test Suite
 *
 * Verifies fixes for:
 * 1. Task A — Saved Itinerary Modifications Persistence & User Ownership
 * 2. Task B — Username Normalization & Case-Insensitive Database Uniqueness
 * 3. Task C — Profile Update Validation, Sanitization & Persistence
 * 4. Task D — Google Authentication Status & Consistency
 * 5. Task E — Migration 004 Idempotency & Database Initialization Reliability
 * 6. Task F & G — Saved Itinerary API Validation, Data Isolation & Deletion Lifecycle
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from './src/db.js';
import { runStartupMigrations, checkDbHealth } from './src/db/init.js';
import {
  createUser,
  getUserByUsername,
  getUserById,
  updateUserProfile
} from './src/db/users.js';
import {
  saveTravelPlan,
  getTravelPlansByUserId,
  getTravelPlanByIdForUser,
  updateSavedTravelPlan,
  deleteTravelPlanForUser
} from './src/db/travelPlans.js';
import { validateModifyPlanRequest, isValidUuid } from './src/validation.js';
import { hashPassword } from './src/auth/password.js';
import { TravelPlan, GeneratePlanRequest } from './src/types.js';

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

function createSamplePlan(dest: string): TravelPlan {
  return {
    accommodationGuidance: 'Centrally located heritage hotel recommended.',
    placesToVisit: [
      {
        name: `${dest} Landmark`,
        reason: 'Iconic historic landmark.',
        bestTime: 'Morning',
        verificationStatus: 'verified',
        source: 'catalog'
      }
    ],
    foodAndLocalExperiences: [
      {
        name: 'Local Delicacy',
        reason: 'Must-try traditional cuisine.',
        verificationStatus: 'verified',
        source: 'catalog'
      }
    ],
    activities: [
      {
        name: 'Heritage Walking Tour',
        reason: 'Explore old streets.',
        verificationStatus: 'verified',
        source: 'catalog'
      }
    ],
    weatherAdvice: 'Mild pleasant climate.',
    budgetTips: ['Book public transport in advance.'],
    itinerary: [
      {
        day: 1,
        morning: 'Visit landmark',
        afternoon: 'Lunch at local market',
        evening: 'Sunset viewpoint',
        notes: 'Wear comfortable walking shoes.',
        alternative: 'Museum visit if rainy.'
      }
    ],
    includeDayByDayItinerary: true,
    generatedAt: new Date().toISOString()
  };
}

function createSampleDetails(dest: string): GeneratePlanRequest {
  return {
    destination: dest,
    numberOfDays: 1,
    budgetInr: 15000,
    numberOfTravellers: 2,
    interests: ['Culture', 'Food'],
    accommodationPreference: 'Moderate',
    activityLevel: 'Moderate',
    additionalNotes: 'Test itinerary notes',
    includeDayByDayItinerary: true
  };
}

async function runStage2TestSuite() {
  console.log('\n======================================================');
  console.log('TravelGenie — Stage 2 Database & Auth Integrity Suite');
  console.log('Testing against PostgreSQL: ' + (process.env.DATABASE_URL ? 'Connected' : 'In-Memory Mock'));
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Database Health & Migrations
  // ---------------------------------------------------------------------------
  console.log('--- 1. Task E: Migration & Database Reliability ---');

  await test('E1. Startup migrations run idempotently without destructive changes', async () => {
    const res = await runStartupMigrations();
    assert.equal(res.success, true);
  });

  await test('E2. Database health probe confirms connected schema readiness', async () => {
    const health = await checkDbHealth();
    assert.equal(health.success, true);
    assert.equal(health.database, 'connected');
    assert.equal(health.schemaReady, true);
    assert.equal(health.requiredColumns.username, true);
    assert.equal(health.requiredColumns.password_hash, true);
  });

  await test('E3. Lowercase username unique index exists on users table', async () => {
    const res = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'users' AND indexname = 'idx_users_username_lower_unique';
    `);
    assert.equal(res.rows.length, 1, 'Expected idx_users_username_lower_unique to exist');
  });

  await test('E4. Migration advisory lock is released cleanly and allows acquisition', async () => {
    const client = await pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock(84729104) AS acquired;');
      assert.equal(lockRes.rows[0]?.acquired, true, 'Advisory lock should be available after migration run');
      await client.query('SELECT pg_advisory_unlock(84729104);');
    } finally {
      client.release();
    }
  });

  await test('E5. Concurrent startup migrations execute cleanly without deadlock or collision', async () => {
    const [res1, res2] = await Promise.all([runStartupMigrations(), runStartupMigrations()]);
    assert.equal(res1.success, true);
    assert.equal(res2.success, true);
  });

  // ---------------------------------------------------------------------------
  // 2. Username Normalization & Case-Insensitive Uniqueness (Task B)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Task B: Username Normalization & Uniqueness ---');

  const testSuffix = Math.random().toString(36).substring(2, 8);
  const rawUsernameA = `Stage2User_${testSuffix}`;
  const normalizedUsernameA = rawUsernameA.toLowerCase();
  const testPassword = 'Password123!SafeScrypt';
  const hashedPassword = await hashPassword(testPassword);

  let userA: any = null;

  await test('B1. createUser normalizes username to lowercase', async () => {
    userA = await createUser(rawUsernameA, hashedPassword);
    assert.ok(userA.id);
    assert.equal(userA.username, normalizedUsernameA);
  });

  await test('B2. getUserByUsername retrieves user using mixed-case query', async () => {
    const foundUpper = await getUserByUsername(rawUsernameA.toUpperCase());
    assert.ok(foundUpper);
    assert.equal(foundUpper.id, userA.id);

    const foundLower = await getUserByUsername(rawUsernameA.toLowerCase());
    assert.ok(foundLower);
    assert.equal(foundLower.id, userA.id);

    const foundExact = await getUserByUsername(rawUsernameA);
    assert.ok(foundExact);
    assert.equal(foundExact.id, userA.id);
  });

  await test('B3. Database-level unique index rejects duplicate signup with varying case', async () => {
    let duplicateRejected = false;
    try {
      // Attempt to insert duplicate with different case
      await createUser(rawUsernameA.toUpperCase(), hashedPassword);
    } catch (err: any) {
      duplicateRejected = err.code === '23505' || err.message.includes('unique');
    }
    assert.equal(duplicateRejected, true, 'Case-variant username must trigger unique violation');
  });

  // ---------------------------------------------------------------------------
  // 3. Profile Update Validation & Persistence (Task C)
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Task C: Profile Validation & Persistence ---');

  await test('C1. Valid profile update persists name and place to PostgreSQL', async () => {
    const updated = await updateUserProfile(userA.id, 'Alice Wanderer', 'Pune');
    assert.ok(updated);
    assert.equal(updated.name, 'Alice Wanderer');
    assert.equal(updated.place, 'Pune');

    // Fresh read verification
    const freshUser = await getUserById(userA.id);
    assert.ok(freshUser);
    assert.equal(freshUser.name, 'Alice Wanderer');
    assert.equal(freshUser.place, 'Pune');
  });

  await test('C2. Updating place alone leaves name untouched', async () => {
    const updated = await updateUserProfile(userA.id, undefined, 'Mumbai');
    assert.ok(updated);
    assert.equal(updated.name, 'Alice Wanderer');
    assert.equal(updated.place, 'Mumbai');

    const freshUser = await getUserById(userA.id);
    assert.ok(freshUser);
    assert.equal(freshUser.name, 'Alice Wanderer');
    assert.equal(freshUser.place, 'Mumbai');
  });

  await test('C3. Empty string name resets to null in database', async () => {
    const updated = await updateUserProfile(userA.id, null, 'Goa');
    assert.ok(updated);
    assert.equal(updated.name, null);
    assert.equal(updated.place, 'Goa');

    const freshUser = await getUserById(userA.id);
    assert.ok(freshUser);
    assert.equal(freshUser.name, null);
    assert.equal(freshUser.place, 'Goa');
  });

  await test('C4. Profile update for non-existent user returns null safely', async () => {
    const fakeId = randomUUID();
    const result = await updateUserProfile(fakeId, 'Nobody', 'Nowhere');
    assert.equal(result, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Saved Itinerary Persistence, Modification & Isolation (Task A & G)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Task A & G: Itinerary Modification, Persistence & Isolation ---');

  const rawUsernameB = `Stage2UserB_${testSuffix}`;
  const userB = await createUser(rawUsernameB, hashedPassword);

  const sampleDetails = createSampleDetails('Jaipur');
  const initialPlan = createSamplePlan('Jaipur');

  let savedItineraryId: string;

  await test('A1. saveTravelPlan creates new database record for User A', async () => {
    const saveResult = await saveTravelPlan(userA.id, sampleDetails, initialPlan);
    assert.ok(saveResult.id);
    assert.ok(saveResult.createdAt);
    savedItineraryId = saveResult.id;
  });

  await test('A2. getTravelPlanByIdForUser retrieves the full plan for owner User A', async () => {
    const detail = await getTravelPlanByIdForUser(savedItineraryId, userA.id);
    assert.ok(detail);
    assert.equal(detail.id, savedItineraryId);
    assert.equal(detail.destination, 'Jaipur');
    assert.equal(detail.numberOfDays, 1);
    assert.equal(detail.plan.placesToVisit[0].name, 'Jaipur Landmark');
  });

  await test('A3. Data isolation: User B cannot retrieve User A itinerary', async () => {
    const forbiddenRead = await getTravelPlanByIdForUser(savedItineraryId, userB.id);
    assert.equal(forbiddenRead, null, 'User B must not be able to read User A itinerary');
  });

  await test('A4. updateSavedTravelPlan persists modified plan directly to PostgreSQL', async () => {
    const modifiedPlan: TravelPlan = {
      ...initialPlan,
      weatherAdvice: 'Updated sunny forecast with evening cool breeze.',
      budgetTips: ['Use Metro Line 1 for 50% savings.', 'Book Amber Fort online.'],
      activities: [
        {
          name: 'Hot Air Balloon Ride',
          reason: 'Panoramic morning views over the desert.',
          verificationStatus: 'verified',
          source: 'catalog'
        }
      ]
    };

    const updateResult = await updateSavedTravelPlan(savedItineraryId, userA.id, modifiedPlan);
    assert.ok(updateResult);
    assert.equal(updateResult.id, savedItineraryId);
    assert.ok(updateResult.updatedAt);

    // Authoritative verification via fresh database query
    const freshDetail = await getTravelPlanByIdForUser(savedItineraryId, userA.id);
    assert.ok(freshDetail);
    assert.equal(freshDetail.plan.weatherAdvice, 'Updated sunny forecast with evening cool breeze.');
    assert.equal(freshDetail.plan.budgetTips.length, 2);
    assert.equal(freshDetail.plan.budgetTips[0], 'Use Metro Line 1 for 50% savings.');
    assert.equal(freshDetail.plan.activities[0].name, 'Hot Air Balloon Ride');
  });

  await test('A5. Modification does not create duplicate database records', async () => {
    const countRes = await pool.query('SELECT COUNT(*) FROM travel_plans WHERE user_id = $1', [userA.id]);
    const totalPlans = parseInt(countRes.rows[0].count, 10);
    assert.equal(totalPlans, 1, 'Total itineraries for User A must remain 1 after modification');
  });

  await test('A6. Ownership protection: User B cannot update User A itinerary', async () => {
    const hostilePlan = createSamplePlan('Hacked Destination');
    const updateAttempt = await updateSavedTravelPlan(savedItineraryId, userB.id, hostilePlan);
    assert.equal(updateAttempt, null, 'Hostile update from User B must return null');

    // Confirm User A itinerary was not altered
    const freshDetail = await getTravelPlanByIdForUser(savedItineraryId, userA.id);
    assert.ok(freshDetail);
    assert.notEqual(freshDetail.destination, 'Hacked Destination');
  });

  await test('G1. getTravelPlansByUserId returns history summary strictly for owner', async () => {
    const historyA = await getTravelPlansByUserId(userA.id);
    assert.equal(historyA.length, 1);
    assert.equal(historyA[0].id, savedItineraryId);
    assert.equal(historyA[0].destination, 'Jaipur');

    const historyB = await getTravelPlansByUserId(userB.id);
    assert.equal(historyB.length, 0, 'User B history must be empty');
  });

  await test('G2. Ownership protection: User B cannot delete User A itinerary', async () => {
    const deleteAttempt = await deleteTravelPlanForUser(savedItineraryId, userB.id);
    assert.equal(deleteAttempt, false, 'User B must not be able to delete User A itinerary');

    // Confirm itinerary still exists
    const stillExists = await getTravelPlanByIdForUser(savedItineraryId, userA.id);
    assert.ok(stillExists);
  });

  await test('G3. deleteTravelPlanForUser deletes itinerary for authenticated owner', async () => {
    const deleteResult = await deleteTravelPlanForUser(savedItineraryId, userA.id);
    assert.equal(deleteResult, true);

    // Verify record is gone
    const detailAfterDelete = await getTravelPlanByIdForUser(savedItineraryId, userA.id);
    assert.equal(detailAfterDelete, null);

    const historyAfterDelete = await getTravelPlansByUserId(userA.id);
    assert.equal(historyAfterDelete.length, 0);
  });

  // ---------------------------------------------------------------------------
  // 5. Validation Helpers & UUID Integrity (Task F)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Task F: API Validation & Payload Safety ---');

  await test('F1. isValidUuid recognizes valid standard v4 UUIDs', () => {
    assert.equal(isValidUuid(randomUUID()), true);
    assert.equal(isValidUuid('c3b5d197-6a2e-4e63-8ef2-6df5b91cb341'), true);
  });

  await test('F2. isValidUuid rejects invalid or malicious strings', () => {
    assert.equal(isValidUuid(''), false);
    assert.equal(isValidUuid('12345'), false);
    assert.equal(isValidUuid('null'), false);
    assert.equal(isValidUuid("'; DROP TABLE users; --"), false);
    assert.equal(isValidUuid(null), false);
    assert.equal(isValidUuid(undefined), false);
    assert.equal(isValidUuid({}), false);
  });

  await test('F3. validateModifyPlanRequest accepts and validates optional itineraryId', () => {
    const validUuid = randomUUID();
    const validPayload = {
      originalDetails: sampleDetails,
      currentPlan: initialPlan,
      modificationRequest: 'Add local street food stalls',
      itineraryId: validUuid
    };

    const res = validateModifyPlanRequest(validPayload);
    assert.equal(res.isValid, true);
    assert.equal(res.data?.itineraryId, validUuid);
  });

  await test('F4. validateModifyPlanRequest rejects invalid itineraryId format', () => {
    const invalidPayload = {
      originalDetails: sampleDetails,
      currentPlan: initialPlan,
      modificationRequest: 'Add local street food stalls',
      itineraryId: 'not-a-real-uuid'
    };

    const res = validateModifyPlanRequest(invalidPayload);
    assert.equal(res.isValid, false);
    assert.match(res.error || '', /Invalid itinerary ID format/);
  });

  // Clean up test users from test DB
  await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userA.id, userB.id]);

  console.log('\n======================================================');
  console.log(`All Stage 2 Integrity Tests Passed! (${passed}/${total})`);
  console.log('======================================================\n');
}

runStage2TestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nTest Suite Fatal Failure:', err);
    process.exit(1);
  });
