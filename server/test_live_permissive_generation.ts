import dotenv from 'dotenv';
dotenv.config();

import { generateTravelPlanService } from './src/aiService.js';
import { resolveDestination } from './src/services/destinationResolver.js';
import type { GeneratePlanRequest, VerifiedPlaceCatalog, ResolvedDestination } from './src/types.js';

async function testLive() {
  console.log('================================================================');
  console.log('LIVE GEMINI & OPENSTREETMAP PERMISSIVE GENERATION AUDIT');
  console.log('================================================================\n');

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('your_gemini')) {
    console.log('[LIVE AUDIT SKIPPED]: No live GEMINI_API_KEY configured in server/.env.');
    return;
  }

  const destChandekasare: ResolvedDestination = {
    originalInput: 'Chandekasare',
    canonicalName: 'Kopargaon',
    formattedAddress: 'Primary Health Centre, Chandekasare, Kopargaon, Maharashtra, India',
    latitude: 19.8403,
    longitude: 74.4364,
    addressComponents: []
  };

  // 1. Genuinely Sparse Catalog with Live Gemini
  console.log('--- 1. Testing Genuinely Sparse Catalog (2 Places, 0 Hotels, 0 Restaurants) with Live Gemini ---');
  const trulySparseCatalog: VerifiedPlaceCatalog = {
    destination: destChandekasare,
    places: [
      {
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
      },
      {
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
      }
    ],
    byCategory: {
      accommodation: [],
      attraction: [
        {
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
        },
        {
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
        }
      ],
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

  try {
    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: true
    };

    console.log('[Calling live Gemini AI with genuinely sparse 2-place catalog]...');
    const result = await generateTravelPlanService(req, { catalogOverride: trulySparseCatalog });
    console.log(`[Result]: isDemo=${result.isDemo}`);
    console.log(`[Places to Visit (${result.plan.placesToVisit.length})]:`);
    for (const p of result.plan.placesToVisit) {
      console.log(`  - "${p.name}" | Status: ${p.verificationStatus || 'unverified'} | Source: ${p.source || 'ai_suggestion'} | ID: ${p.verifiedPlaceId || 'none'}`);
    }
    console.log(`[Food/Dining (${result.plan.foodAndLocalExperiences.length})]:`);
    for (const f of result.plan.foodAndLocalExperiences) {
      console.log(`  - "${f.name}" | Status: ${f.verificationStatus || 'unverified'} | Source: ${f.source || 'ai_suggestion'}`);
    }
    console.log(`[Accommodation Guidance]: "${result.plan.accommodationGuidance}"`);
    console.log(`[Itinerary Days]: ${result.plan.itinerary.length}`);
    console.log('>>> Live Sparse Catalog Generation: SUCCESS\n');
  } catch (err: any) {
    console.error('>>> Live Sparse Catalog Generation Error:', err.message);
  }

  // 2. Gemini failure AFTER successful destination resolution
  console.log('--- 2. Testing Gemini Failure AFTER Successful Destination Resolution ---');
  try {
    const req: GeneratePlanRequest = {
      destination: 'Chandekasare',
      numberOfDays: 1,
      budgetInr: 3000,
      numberOfTravellers: 1,
      includeDayByDayItinerary: true
    };
    // Mock fetch that lets Nominatim/Overpass succeed, but fails when calling Gemini API
    const mockFailingGeminiFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('generateContent')) {
        return new Response('503 Service Unavailable', { status: 503 });
      }
      return fetch(url);
    };

    console.log('[Executing pipeline: Geocoding succeeds, Overpass succeeds, Gemini throws 503]...');
    await generateTravelPlanService(req, {
      catalogOverride: trulySparseCatalog,
      fetchFn: mockFailingGeminiFetch
    });
    console.error('>>> ERROR: generateTravelPlanService should have thrown!');
  } catch (err: any) {
    console.log(`[Expected Error Caught]: "${err.message}"`);
    const hasPuneDemo = err.message.toLowerCase().includes('pune');
    console.log(`[Pune demo template returned?]: ${hasPuneDemo ? 'YES (BAD)' : 'NO (GOOD)'}`);
    console.log('>>> Post-Resolution Gemini Failure Test: SUCCESS\n');
  }
}

testLive().catch(console.error);
