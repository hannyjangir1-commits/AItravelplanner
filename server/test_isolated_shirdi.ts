/**
 * Isolated Test for Destination Resolution (Shirdi & Ambiguity Handling).
 * Verifies that:
 * 1. "Shirdi" resolves to Sainagar/Shirdi, Maharashtra, India without false ambiguity errors.
 * 2. True ambiguities (like Springfield) still trigger DestinationAmbiguityError.
 */

import assert from 'node:assert/strict';
import { resolveDestination } from './src/services/destinationResolver.js';
import { geocodeDestinationWithOsm, DestinationAmbiguityError } from './src/services/osmProvider.js';

async function runIsolatedTest() {
  console.log('=== ISOLATED DESTINATION RESOLUTION TEST ===\n');

  // Test 1: Shirdi live resolution with strict 10s timeout
  console.log('1. Testing Live Resolution for "Shirdi" (timeout=10000ms)...');
  const start = Date.now();
  const resolved = await resolveDestination('Shirdi', { timeoutMs: 10000 });
  const elapsed = Date.now() - start;

  console.log(`[PASS] Resolved in ${elapsed}ms:`);
  console.log(`  Canonical Name:    "${resolved.canonicalName}"`);
  console.log(`  Coordinates:       (${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)})`);
  console.log(`  Formatted Address: ${resolved.formattedAddress}`);

  assert.ok(
    resolved.canonicalName.toLowerCase().includes('sainagar') ||
    resolved.canonicalName.toLowerCase().includes('shirdi'),
    `Expected canonicalName to contain Shirdi or Sainagar, got: "${resolved.canonicalName}"`
  );
  assert.ok(
    resolved.formattedAddress.toLowerCase().includes('maharashtra') ||
    resolved.formattedAddress.toLowerCase().includes('india'),
    `Expected address in Maharashtra/India, got: "${resolved.formattedAddress}"`
  );
  assert.ok(Math.abs(resolved.latitude - 19.76) < 0.2, `Expected latitude ~19.76, got ${resolved.latitude}`);

  // Test 2: True ambiguity rejection remains intact
  console.log('\n2. Testing True Ambiguity Rejection ("Springfield")...');
  const AMBIGUOUS_MOCK = [
    {
      place_id: 101,
      osm_type: 'node',
      osm_id: 201,
      lat: '39.7817',
      lon: '-89.6501',
      display_name: 'Springfield, Illinois, United States',
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
      display_name: 'Springfield, Missouri, United States',
      name: 'Springfield',
      importance: 0.71,
      address: { city: 'Springfield', state: 'Missouri', country: 'United States', country_code: 'us' }
    }
  ];

  const mockFetch = async () => new Response(JSON.stringify(AMBIGUOUS_MOCK), { status: 200 });
  await assert.rejects(
    async () => geocodeDestinationWithOsm('Springfield', { fetchFn: mockFetch as any }),
    (err: any) => {
      assert.ok(err instanceof DestinationAmbiguityError, 'Must throw DestinationAmbiguityError');
      assert.ok(err.candidateMatches.length === 2);
      return true;
    }
  );
  console.log('[PASS] True ambiguity correctly rejected with DestinationAmbiguityError.');

  console.log('\n=== ISOLATED TEST COMPLETED SUCCESSFULLY ===');
}

runIsolatedTest().catch(err => {
  console.error('\n[ISOLATED TEST FAILED]:', err);
  process.exit(1);
});
