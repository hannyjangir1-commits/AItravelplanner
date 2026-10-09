/**
 * Opt-In Live OpenStreetMap Integration Test for TravelGenie.
 *
 * Usage:
 *   npx tsx test_live_osm_pipeline.ts --live
 *
 * In live mode:
 *   - Respects Nominatim rate limits (minimum 1,000ms delay).
 *   - Sends compliant User-Agent identification.
 *   - Geocodes real Mumbai destination via Nominatim.
 *   - Queries Overpass API for real attractions in Mumbai.
 *   - Runs the resulting catalog through the TravelGenie validator.
 *
 * In standard mode (without --live):
 *   - Runs with realistic hermetic fixtures.
 *   - Delineates clearly between mock tests and live network tests.
 */

import assert from 'node:assert/strict';
import {
  geocodeDestinationWithOsm,
  searchOsmPlacesNearby,
  InternalOsmPlace
} from './src/services/osmProvider.js';
import {
  resolveDestination,
  ResolvedDestination
} from './src/services/destinationResolver.js';
import {
  buildVerifiedPlaceCatalog,
  formatCatalogForPrompt,
  VerifiedPlaceCatalog
} from './src/services/placeCatalog.js';
import { validateAndSanitizeTravelPlan } from './src/services/travelPlanValidator.js';

const isLiveRequested = process.argv.includes('--live');

console.log('================================================================');
console.log('       OPENSTREETMAP (NOMINATIM & OVERPASS) INTEGRATION TEST     ');
console.log('================================================================');
console.log(`Live Network Mode: ${isLiveRequested ? 'ENABLED (--live flag detected)' : 'SIMULATION (run with --live for real network calls)'}`);
console.log('================================================================\n');

async function run() {
  let resolved: ResolvedDestination;
  let catalog: VerifiedPlaceCatalog;

  if (isLiveRequested) {
    console.log('[LIVE MODE] Querying OpenStreetMap public infrastructure politely...\n');

    process.stdout.write('1. Geocoding "Mumbai" via live Nominatim API... ');
    resolved = await resolveDestination('Mumbai');
    console.log(`PASSED -> Canonical="${resolved.canonicalName}", Lat=${resolved.latitude.toFixed(4)}, Lon=${resolved.longitude.toFixed(4)}`);
    assert.ok(resolved.canonicalName.toLowerCase().includes('mumbai'));

    process.stdout.write('2. Discovering places near Mumbai via live Overpass API (radius=5km)... ');
    catalog = await buildVerifiedPlaceCatalog(resolved, { maxRadiusMeters: 5000 });
    console.log(`PASSED -> Found ${catalog.places.length} verified OSM places (Attractions: ${catalog.byCategory.attraction.length}, Accommodations: ${catalog.byCategory.accommodation.length}, Dining: ${catalog.byCategory.restaurant.length})`);
    assert.ok(catalog.places.length > 0, 'Expected at least 1 real OSM place in Mumbai');

  } else {
    console.log('[SIMULATION MODE] Using verified Mumbai OSM test fixtures.\n');
    console.log('To run against live public OSM servers:');
    console.log('  npx tsx test_live_osm_pipeline.ts --live\n');

    resolved = {
      originalInput: 'Mumbai',
      canonicalName: 'Mumbai',
      formattedAddress: 'Mumbai, Maharashtra, India',
      latitude: 18.9220,
      longitude: 72.8347,
      providerPlaceId: 'osm:relation/78910',
      addressComponents: []
    };

    const rawElements = [
      {
        type: 'node',
        id: 1001,
        lat: 18.9220,
        lon: 72.8347,
        tags: {
          name: 'Gateway of India',
          tourism: 'attraction',
          historic: 'monument'
        }
      },
      {
        type: 'way',
        id: 1002,
        center: { lat: 18.9432, lon: 72.8230 },
        tags: {
          name: 'Marine Drive',
          leisure: 'park',
          tourism: 'attraction'
        }
      },
      {
        type: 'node',
        id: 2001,
        lat: 18.9217,
        lon: 72.8333,
        tags: {
          name: 'The Taj Mahal Palace, Mumbai',
          tourism: 'hotel'
        }
      }
    ];

    const mockFetch = async () => new Response(JSON.stringify({ elements: rawElements }), { status: 200 });
    catalog = await buildVerifiedPlaceCatalog(resolved, { fetchFn: mockFetch as any });
  }

  process.stdout.write('3. Verifying prompt catalog formatting... ');
  const promptText = formatCatalogForPrompt(catalog);
  assert.ok(promptText.includes('Destination Anchor: Mumbai'));
  assert.ok(promptText.includes('OpenStreetMap contributors'));
  console.log('PASSED');

  process.stdout.write('4. Testing validator with synthetic Gemini response... ');
  const attr1 = catalog.byCategory.attraction[0] || catalog.places[0];
  const stay = catalog.byCategory.accommodation[0] || catalog.places[0];

  const syntheticPlan: any = {
    destination: 'Mumbai',
    duration: 2,
    budget: '₹20,000',
    accommodationGuidance: stay ? `Stay at ${stay.name} (${stay.internalId}).` : 'Central lodging recommended.',
    placesToVisit: [
      {
        name: attr1.name,
        verifiedPlaceId: attr1.internalId,
        reason: 'Iconic historic landmark.',
        bestTime: 'Morning'
      },
      {
        name: 'Fictional Flying Palace',
        reason: 'Unverified entity.',
        bestTime: 'Afternoon'
      }
    ],
    foodAndLocalExperiences: [],
    activities: [],
    weatherAdvice: 'Coastal weather',
    budgetTips: ['Use public transport'],
    includeDayByDayItinerary: true,
    itinerary: [
      {
        day: 1,
        morning: `Visit ${attr1.name}.`,
        morningPlaceId: attr1.internalId,
        afternoon: 'Waterfront exploration.',
        evening: 'Dinner.',
        notes: 'Transit card.',
        alternative: 'Rest.'
      },
      {
        day: 2,
        morning: 'Promenade stroll.',
        afternoon: 'Museum visit.',
        evening: 'Sunset view.',
        notes: 'Sun protection.',
        alternative: 'Cafe.'
      }
    ]
  };

  const { plan: validated, validationReport } = validateAndSanitizeTravelPlan(syntheticPlan, catalog);
  assert.ok(!validated.placesToVisit.some((p) => p.name === 'Fictional Flying Palace'), 'Unverified place must be stripped');
  assert.equal(validationReport.removedPlaceReferences, 1);
  assert.equal(validated.includeDayByDayItinerary, true);
  assert.equal(validated.itinerary.length, 2);
  console.log('PASSED');

  console.log('\n================================================================');
  console.log('ALL INTEGRATION CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('Fatal Integration Test Error:', err);
  process.exit(1);
});
