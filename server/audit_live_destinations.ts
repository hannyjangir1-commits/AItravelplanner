/**
 * Live Audit Script for TravelGenie OpenStreetMap Migration.
 * Runs live Nominatim and Overpass requests for Mumbai, Pune, Shirdi, Chandekasare.
 * Analyzes POIs by category, search radius, tag mapping, and rate limits.
 */

import { geocodeDestinationWithOsm, searchOsmPlacesNearby, clearOsmCache, InternalOsmPlace } from './src/services/osmProvider.js';
import { resolveDestination, ResolvedDestination } from './src/services/destinationResolver.js';
import { buildVerifiedPlaceCatalog, VerifiedPlaceCatalog } from './src/services/placeCatalog.js';

interface DestinationAuditResult {
  destination: string;
  resolved: ResolvedDestination;
  tier5km: { total: number; byCategory: Record<string, number>; sampleAccommodations: string[] };
  tier15km: { total: number; byCategory: Record<string, number>; sampleAccommodations: string[] };
  tier25km: { total: number; byCategory: Record<string, number>; sampleAccommodations: string[] };
  catalogResult: {
    total: number;
    accommodations: number;
    attractions: number;
    restaurants: number;
    activities: number;
    samplePlaces: { name: string; category: string; locality: string; distance: string }[];
  };
}

const destinations = ['Mumbai', 'Pune', 'Shirdi', 'Chandekasare'];

async function inspectTier(
  coords: { latitude: number; longitude: number },
  radiusMeters: number
): Promise<{ total: number; byCategory: Record<string, number>; sampleAccommodations: string[] }> {
  // Clear cache for fresh radius-specific check
  const places = await searchOsmPlacesNearby({
    coordinates: coords,
    radiusMeters,
    maxResults: 500
  });

  const byCat: Record<string, number> = {
    accommodation: 0,
    attraction: 0,
    restaurant: 0,
    activity: 0,
    poi: 0
  };
  const accoms: string[] = [];

  for (const p of places) {
    const cat = p.categoryHint || 'poi';
    byCat[cat] = (byCat[cat] || 0) + 1;
    if (cat === 'accommodation') {
      accoms.push(`${p.name} (${(p.distanceMeters / 1000).toFixed(1)}km, types: ${p.types.join('/')})`);
    }
  }

  return {
    total: places.length,
    byCategory: byCat,
    sampleAccommodations: accoms.slice(0, 5)
  };
}

async function runAudit() {
  console.log('================================================================');
  console.log('       TRAVELGENIE LIVE OPENSTREETMAP AUDIT & DIAGNOSTICS        ');
  console.log('================================================================\n');

  const auditResults: DestinationAuditResult[] = [];

  for (const dest of destinations) {
    console.log(`\n================================================================`);
    console.log(`AUDITING DESTINATION: ${dest}`);
    console.log(`================================================================`);

    // 1. Live Nominatim Geocoding
    console.log(`\n[Step 1] Resolving "${dest}" with live Nominatim geocoder...`);
    const resolved = await resolveDestination(dest);
    console.log(`  -> Canonical Name:     ${resolved.canonicalName}`);
    console.log(`  -> Coordinates:        (${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)})`);
    console.log(`  -> Formatted Address:  ${resolved.formattedAddress}`);

    const coords = { latitude: resolved.latitude, longitude: resolved.longitude };

    // 2. Querying 5km, 15km, 25km radii
    console.log(`\n[Step 2] Querying Overpass API across concentric radii...`);
    
    console.log(`  Querying 5 km radius...`);
    const tier5 = await inspectTier(coords, 5000);
    console.log(`    Total: ${tier5.total} | Accommodations: ${tier5.byCategory.accommodation || 0} | Attractions: ${tier5.byCategory.attraction || 0} | Dining: ${tier5.byCategory.restaurant || 0} | Activities: ${tier5.byCategory.activity || 0}`);
    if (tier5.sampleAccommodations.length > 0) {
      console.log(`    Sample Accommodations: ${tier5.sampleAccommodations.join('; ')}`);
    }

    console.log(`  Querying 15 km radius...`);
    const tier15 = await inspectTier(coords, 15000);
    console.log(`    Total: ${tier15.total} | Accommodations: ${tier15.byCategory.accommodation || 0} | Attractions: ${tier15.byCategory.attraction || 0} | Dining: ${tier15.byCategory.restaurant || 0} | Activities: ${tier15.byCategory.activity || 0}`);
    if (tier15.sampleAccommodations.length > 0) {
      console.log(`    Sample Accommodations: ${tier15.sampleAccommodations.join('; ')}`);
    }

    console.log(`  Querying 25 km radius...`);
    const tier25 = await inspectTier(coords, 25000);
    console.log(`    Total: ${tier25.total} | Accommodations: ${tier25.byCategory.accommodation || 0} | Attractions: ${tier25.byCategory.attraction || 0} | Dining: ${tier25.byCategory.restaurant || 0} | Activities: ${tier25.byCategory.activity || 0}`);
    if (tier25.sampleAccommodations.length > 0) {
      console.log(`    Sample Accommodations: ${tier25.sampleAccommodations.join('; ')}`);
    }

    // 3. End-to-End Catalog Builder
    console.log(`\n[Step 3] Building end-to-end verified place catalog...`);
    const catalog = await buildVerifiedPlaceCatalog(resolved);
    console.log(`  -> Catalog Total:        ${catalog.places.length}`);
    console.log(`  -> Accommodations:       ${catalog.byCategory.accommodation.length}`);
    console.log(`  -> Attractions:          ${catalog.byCategory.attraction.length}`);
    console.log(`  -> Dining (Restaurants): ${catalog.byCategory.restaurant.length}`);
    console.log(`  -> Activities:           ${catalog.byCategory.activity.length}`);

    const sample = catalog.places.slice(0, 6).map((p) => ({
      name: p.name,
      category: p.primaryCategory,
      locality: p.localityRelation,
      distance: `${(p.distanceMeters / 1000).toFixed(1)}km`
    }));

    auditResults.push({
      destination: dest,
      resolved,
      tier5km: tier5,
      tier15km: tier15,
      tier25km: tier25,
      catalogResult: {
        total: catalog.places.length,
        accommodations: catalog.byCategory.accommodation.length,
        attractions: catalog.byCategory.attraction.length,
        restaurants: catalog.byCategory.restaurant.length,
        activities: catalog.byCategory.activity.length,
        samplePlaces: sample
      }
    });
  }

  console.log('\n\n================================================================');
  console.log('                     FINAL AUDIT SUMMARY TABLE                  ');
  console.log('================================================================');
  console.table(
    auditResults.map((r) => ({
      Destination: r.destination,
      Coordinates: `(${r.resolved.latitude.toFixed(2)}, ${r.resolved.longitude.toFixed(2)})`,
      '5km POIs (Acc/Att/Rest)': `${r.tier5km.byCategory.accommodation || 0} / ${r.tier5km.byCategory.attraction || 0} / ${r.tier5km.byCategory.restaurant || 0} (tot: ${r.tier5km.total})`,
      '15km POIs (Acc/Att/Rest)': `${r.tier15km.byCategory.accommodation || 0} / ${r.tier15km.byCategory.attraction || 0} / ${r.tier15km.byCategory.restaurant || 0} (tot: ${r.tier15km.total})`,
      '25km POIs (Acc/Att/Rest)': `${r.tier25km.byCategory.accommodation || 0} / ${r.tier25km.byCategory.attraction || 0} / ${r.tier25km.byCategory.restaurant || 0} (tot: ${r.tier25km.total})`,
      'Catalog Places': r.catalogResult.total,
      'Catalog Accomm': r.catalogResult.accommodations,
      'Catalog Attr': r.catalogResult.attractions
    }))
  );
}

runAudit().catch((err) => {
  console.error('Fatal Audit Error:', err);
  process.exit(1);
});
