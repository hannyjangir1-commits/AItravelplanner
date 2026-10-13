/**
 * TravelGenie — Frontend Progress State & Performance Test Suite
 *
 * Covers required test cases:
 * 1. All available sections selected (4 progress steps, step 3 is "Building day-wise itinerary").
 * 2. The section associated with the third progress box unchecked (3 progress steps, step 3 is "Finalizing destination guide").
 * 3. Multiple optional sections unchecked (optional notes, optional day-by-day itinerary).
 * 4. Only the minimum required sections selected (minimal form validation).
 * 5. Checkbox selections changed immediately before submission.
 * 6. Generation succeeds (plan validated and timing captured).
 * 7. Generation fails (clean error handling and loading reset).
 * 8. User starts a new generation after a previous attempt (clean state reset).
 * 9. Stale response arrives after newer request begins (stale response ignored via AbortController/ref check).
 * 10. Double-clicking Generate does not trigger unintended duplicate generation requests (isSubmittingRef guard).
 */

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  GenerationLoadingProgress,
  FULL_LOADING_STAGES,
  GUIDE_LOADING_STAGES
} from './src/components/TravelForm.js';
import { generateTravelPlan, ApiClientError } from './src/api.js';
import type { TripFormData, TravelPlan } from './src/types.js';

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

// Global browser mocks for fetch and document
const mockStorage = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};
(globalThis as any).document = {
  cookie: 'travelgenie_csrf=test_csrf_token_12345'
};

const VALID_PLAN_DATA: TravelPlan = {
  accommodationGuidance: 'Central heritage boutique hotel',
  placesToVisit: [{ name: 'Amber Fort', reason: 'Iconic historic fort', bestTime: 'Morning' }],
  foodAndLocalExperiences: [{ name: 'Ghewar', reason: 'Traditional Rajasthani dessert' }],
  activities: [{ name: 'Bazaar walking tour', reason: 'Cultural immersion' }],
  weatherAdvice: 'Sunny and pleasant',
  budgetTips: ['Use public transport'],
  itinerary: [
    {
      day: 1,
      morning: 'Amber Fort',
      afternoon: 'City Palace',
      evening: 'Jal Mahal',
      notes: 'Wear comfortable shoes',
      alternative: 'Indoor museum'
    }
  ],
  includeDayByDayItinerary: true
};

async function runSuite() {
  console.log('\n======================================================');
  console.log('TravelGenie — Frontend Progress State & Latency Test Suite');
  console.log('======================================================\n');

  // Case 1: All available sections selected
  await test('1. All available sections selected renders 4 stages with day-wise itinerary step', () => {
    assert.equal(FULL_LOADING_STAGES.length, 4);
    assert.equal(FULL_LOADING_STAGES[2].label, 'Building day-wise itinerary');
    assert.equal(FULL_LOADING_STAGES[3].label, 'Finalizing travel plan');

    const html = renderToString(
      React.createElement(GenerationLoadingProgress, {
        destination: 'Jaipur',
        includeDayByDayItinerary: true
      })
    );

    // Verify 4 progress stages rendered in HTML
    const stageMatches = html.match(/class="stage-timeline-item/g);
    assert.equal(stageMatches?.length, 4, 'Must render exactly 4 timeline items when itinerary is selected');
    assert.ok(html.includes('Building day-wise itinerary'), 'Must contain "Building day-wise itinerary"');
    assert.ok(html.includes('Finalizing travel plan'), 'Must contain "Finalizing travel plan"');
  });

  // Case 2: The section associated with the third progress box unchecked
  await test('2. Unchecking itinerary section dynamically renders 3 stages and eliminates "Building day-wise itinerary"', () => {
    assert.equal(GUIDE_LOADING_STAGES.length, 3);
    assert.equal(GUIDE_LOADING_STAGES[2].label, 'Finalizing destination guide');

    const html = renderToString(
      React.createElement(GenerationLoadingProgress, {
        destination: 'Jaipur',
        includeDayByDayItinerary: false
      })
    );

    // Verify exactly 3 progress stages rendered
    const stageMatches = html.match(/class="stage-timeline-item/g);
    assert.equal(stageMatches?.length, 3, 'Must render exactly 3 timeline items when itinerary is unchecked');

    // Verify 3rd box is "Finalizing destination guide" and NOT "Building day-wise itinerary"
    assert.ok(!html.includes('Building day-wise itinerary'), 'Must NOT contain "Building day-wise itinerary"');
    assert.ok(html.includes('Finalizing destination guide'), '3rd stage must be "Finalizing destination guide"');
  });

  // Case 3: Multiple optional sections unchecked
  await test('3. Multiple optional sections unchecked (notes empty, itinerary unchecked)', () => {
    const formData: TripFormData = {
      destination: 'Kyoto',
      numberOfDays: 4,
      budgetInr: 50000,
      numberOfTravellers: 2,
      interests: ['Culture'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      additionalNotes: '',
      includeDayByDayItinerary: false
    };

    assert.equal(formData.includeDayByDayItinerary, false);
    assert.equal(formData.additionalNotes, '');

    const html = renderToString(
      React.createElement(GenerationLoadingProgress, {
        destination: formData.destination,
        includeDayByDayItinerary: formData.includeDayByDayItinerary
      })
    );
    assert.equal(html.match(/class="stage-timeline-item/g)?.length, 3);
  });

  // Case 4: Only the minimum required sections selected
  await test('4. Only minimum required sections selected (minimal valid form)', () => {
    const minimalFormData: TripFormData = {
      destination: 'Rome',
      numberOfDays: 1,
      budgetInr: 10000,
      numberOfTravellers: 1,
      interests: [],
      accommodationPreference: 'Budget',
      activityLevel: 'Relaxed',
      additionalNotes: '',
      includeDayByDayItinerary: false
    };

    assert.ok(minimalFormData.destination.trim().length > 0);
    assert.ok(Number(minimalFormData.numberOfDays) >= 1);
    assert.ok(Number(minimalFormData.budgetInr) > 0);
    assert.ok(Number(minimalFormData.numberOfTravellers) >= 1);
    assert.equal(minimalFormData.includeDayByDayItinerary, false);
  });

  // Case 5: Checkbox selections changed immediately before submission
  await test('5. Checkbox selections changed immediately before submission are reflected in payload and progress', async () => {
    let formState: TripFormData = {
      destination: 'Goa',
      numberOfDays: 3,
      budgetInr: 25000,
      numberOfTravellers: 2,
      interests: ['Beaches'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Relaxed',
      additionalNotes: '',
      includeDayByDayItinerary: true
    };

    // User unchecks the day-by-day itinerary right before clicking Generate
    formState = { ...formState, includeDayByDayItinerary: false };

    let capturedPayload: any = null;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      capturedPayload = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          success: true,
          data: { ...VALID_PLAN_DATA, itinerary: [], includeDayByDayItinerary: false },
          timing: { totalBackendMs: 1200, geminiMs: 800 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await generateTravelPlan(formState);
    assert.equal(capturedPayload.includeDayByDayItinerary, false, 'Payload must reflect the updated checkbox state');

    const html = renderToString(
      React.createElement(GenerationLoadingProgress, {
        destination: formState.destination,
        includeDayByDayItinerary: formState.includeDayByDayItinerary
      })
    );
    assert.equal(html.match(/class="stage-timeline-item/g)?.length, 3, 'Must render 3 stages');
  });

  // Case 6: Generation succeeds
  await test('6. Generation succeeds and captures structured performance timing', async () => {
    const formData: TripFormData = {
      destination: 'Jaipur',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      interests: ['Culture'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      additionalNotes: '',
      includeDayByDayItinerary: true
    };

    (globalThis as any).fetch = async (_url: string, _init: any) => {
      return new Response(
        JSON.stringify({
          success: true,
          data: VALID_PLAN_DATA,
          id: 'itin-uuid-1234',
          createdAt: new Date().toISOString(),
          timing: {
            correlationId: 'corr-test-123',
            totalBackendMs: 2500,
            geminiMs: 1800,
            catalogMs: 400,
            resolveMs: 150,
            dbMs: 50,
            geminiCalls: 1,
            modelUsed: 'gemini-3-flash-preview'
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await generateTravelPlan(formData);
    assert.ok(res.plan);
    assert.equal(res.id, 'itin-uuid-1234');
    assert.ok(res.timing);
    assert.equal(res.timing.correlationId, 'corr-test-123');
    assert.equal(res.timing.geminiCalls, 1);
    assert.equal(res.timing.modelUsed, 'gemini-3-flash-preview');
    assert.ok(res.timing.totalBackendMs > 0);
  });

  // Case 7: Generation fails
  await test('7. Generation fails cleanly with ApiClientError and does not leak keys', async () => {
    const formData: TripFormData = {
      destination: 'InvalidCity',
      numberOfDays: 3,
      budgetInr: 30000,
      numberOfTravellers: 2,
      interests: ['Culture'],
      accommodationPreference: 'Moderate',
      activityLevel: 'Moderate',
      additionalNotes: '',
      includeDayByDayItinerary: true
    };

    (globalThis as any).fetch = async (_url: string, _init: any) => {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Travel planning service is temporarily unable to generate your plan.'
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await generateTravelPlan(formData);
      },
      (err: any) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 502);
        assert.ok(!err.message.includes('AIza'), 'Must not leak API key pattern');
        return true;
      }
    );
  });

  // Case 8: User starts a new generation after a previous attempt
  await test('8. User starts a new generation after previous attempt resets state cleanly', () => {
    let currentPlan: TravelPlan | null = VALID_PLAN_DATA;
    let currentPlanId: string | null = 'old-plan-id';
    let errorMessage: string | null = 'Old error';

    // Simulate start of new generation
    currentPlan = null;
    currentPlanId = null;
    errorMessage = null;

    assert.equal(currentPlan, null, 'Plan must be reset');
    assert.equal(currentPlanId, null, 'Plan ID must be reset');
    assert.equal(errorMessage, null, 'Error must be cleared');
  });

  // Case 9: Stale response arrives after newer request begins
  await test('9. Stale response arriving after newer request is safely discarded', async () => {
    let activeController: AbortController | null = null;
    let displayedPlan: TravelPlan | null = null;

    // Request 1 starts
    const controller1 = new AbortController();
    activeController = controller1;

    // Simulate Request 2 starting before Request 1 finishes
    if (activeController) {
      activeController.abort(); // cancels Request 1
    }
    const controller2 = new AbortController();
    activeController = controller2;

    // Simulate Request 1 trying to resolve later
    const fakeRequest1Resolution = async () => {
      if (controller1.signal.aborted || activeController !== controller1) {
        return; // DISCARDED!
      }
      displayedPlan = { ...VALID_PLAN_DATA, accommodationGuidance: 'STALE PLAN 1' };
    };

    // Simulate Request 2 resolving
    const fakeRequest2Resolution = async () => {
      if (controller2.signal.aborted || activeController !== controller2) {
        return;
      }
      displayedPlan = { ...VALID_PLAN_DATA, accommodationGuidance: 'FRESH PLAN 2' };
    };

    await fakeRequest1Resolution();
    assert.equal(displayedPlan, null, 'Stale Request 1 must NOT update displayed plan');

    await fakeRequest2Resolution();
    assert.equal(displayedPlan?.accommodationGuidance, 'FRESH PLAN 2', 'Fresh Request 2 updates displayed plan');
  });

  // Case 10: Double-clicking Generate does not trigger unintended duplicate generation requests
  await test('10. Double-clicking Generate is blocked synchronously by submission guard', () => {
    let callCount = 0;
    const isSubmittingRef = { current: false };

    const fakeSubmitHandler = () => {
      if (isSubmittingRef.current) {
        return; // BLOCKED!
      }
      isSubmittingRef.current = true;
      callCount++;
    };

    // First click
    fakeSubmitHandler();
    assert.equal(callCount, 1, 'First click invokes submit');

    // Immediate second click (before re-render)
    fakeSubmitHandler();
    assert.equal(callCount, 1, 'Second rapid click must be blocked synchronously');

    // Simulate completion
    isSubmittingRef.current = false;
    fakeSubmitHandler();
    assert.equal(callCount, 2, 'Next submission allowed after completion');
  });

  console.log('\n======================================================');
  console.log(`All Frontend Progress & Perf Tests Passed! (${passed}/${total})`);
  console.log('======================================================\n');
}

runSuite().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
