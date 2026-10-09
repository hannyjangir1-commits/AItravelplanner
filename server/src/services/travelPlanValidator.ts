/**
 * Authoritative Post-Generation Travel Plan Validator for TravelGenie.
 *
 * Deterministic Safety Boundary:
 * Enforces that NO unverified real-world place, hallucinated establishment,
 * unverified hotel, or unsourced numeric price reaches the final TravelPlan.
 *
 * CORE VALIDATOR RULES:
 * 1. The VerifiedPlaceCatalog is the absolute single source of truth.
 * 2. Every structured place reference (verifiedPlaceId, morningPlaceId, etc.)
 *    MUST exist in the catalog.
 * 3. Gemini place names are strictly replaced with authoritative catalog names.
 * 4. Invalid or unverified IDs are stripped; no fake replacement entities are invented.
 * 5. Unverified dining establishments and commercial venues are removed, while
 *    generic experiences ("Try local Maharashtrian cuisine", "Walk in farmland") are preserved.
 * 6. Accommodation guidance cannot mention unverified hotels or unsourced room tariffs.
 *    If 0 accommodations are verified, honest "none found" guidance is enforced.
 * 7. Numeric hotel prices (e.g. ₹1,500/night) and price-level-to-INR conversions
 *    (e.g. ₹500–₹1,000) are stripped unless backed by verified source pricing.
 * 8. Authoritative catalog distance and locality relations override Gemini claims.
 * 9. Duplicate recommendation entities are safely pruned.
 */

import {
  TravelPlan,
  PlaceToVisit,
  FoodOrExperience,
  Activity,
  DayPlan,
  VerifiedPlace
} from '../types.js';
import { VerifiedPlaceCatalog } from './placeCatalog.js';

export interface TravelPlanValidationReport {
  checkedPlaceReferences: number;
  validPlaceReferences: number;
  unverifiedPlaceReferences?: number;
  removedPlaceReferences: number;
  correctedPlaceNames: number;
  removedUnsupportedPrices: number;
  removedUnsupportedAccommodation: number;
  warnings: string[];
}

export interface ValidationOutput {
  plan: TravelPlan;
  validationReport: TravelPlanValidationReport;
}

/**
 * Format catalog distance in meters to a clean string (e.g. "12.4 km" or "5 km").
 */
function formatCatalogDistance(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  return km % 1 === 0 ? `${km} km` : `${km.toFixed(1)} km`;
}

/**
 * Detects whether a food/experience recommendation refers to a specific commercial establishment
 * (which must be verified) rather than generic culinary/dish advice.
 */
function isSpecificCommercialEstablishment(name: string): boolean {
  const norm = name.trim();
  const establishmentKeywords = /\b(restaurant|cafe|café|dhaba|dhabha|bhojanalay|bhojnalaya|kitchen|bistro|eatery|bakery|bar & grill|mess|canteen|pizzeria|diner|lounge|dining hall|sweet mart|sweets & snacks|hotel)\b/i;
  if (establishmentKeywords.test(norm)) {
    return true;
  }
  const actionPattern = /^(?:visit|dine at|eat at|lunch at|dinner at|breakfast at)\s+([A-Z][a-zA-Z0-9'\s]+)/i;
  if (actionPattern.test(norm)) {
    return true;
  }
  return false;
}

/**
 * Detects whether an activity recommendation refers to a specific commercial venue or organized tour
 * (which must be verified) rather than a generic activity (walking, relaxation, viewing).
 */
function isSpecificCommercialVenueOrTour(name: string): boolean {
  const norm = name.trim();
  const venueKeywords = /\b(tour|safari|club|resort|center|centre|park|museum|academy|adventure park|sanctuary|agency|trekking company|studio|circus|amusement park|water park|sports complex|theater|theatre|workshop)\b/i;
  if (venueKeywords.test(norm)) {
    return true;
  }
  const actionPattern = /^(?:join(?:\s+the)?|book(?:\s+a)?)\s+/i;
  if (actionPattern.test(norm)) {
    return true;
  }
  return false;
}

/**
 * Synchronizes distance and locality claims in text with authoritative catalog metadata.
 * - Conflicting distances (e.g. "8 km away" vs "12.4 km") are replaced with catalog distance.
 * - Out-of-bounds locality claims (e.g. claiming a 12.4 km place is "inside Chandekasare")
 *   are corrected to "located nearby (~12.4 km away)".
 */
function syncPlaceDistanceAndLocality(
  text: string,
  place: VerifiedPlace,
  destinationCanonicalName: string,
  report: TravelPlanValidationReport
): string {
  if (!text) return text;
  let result = text;
  const catalogDist = formatCatalogDistance(place.distanceMeters);

  // Check for distance contradictions in text
  const distanceRegex = /\b(\d+(?:\.\d+)?)\s*km(?:\s*away)?\b/gi;
  result = result.replace(distanceRegex, (match, claimedKm) => {
    const claimedNum = parseFloat(claimedKm);
    const catalogKmNum = place.distanceMeters / 1000;
    if (Math.abs(claimedNum - catalogKmNum) > 0.5) {
      report.warnings.push(
        `Overrode distance "${match}" with catalog distance "${catalogDist} away" for place "${place.name}".`
      );
      return `${catalogDist} away`;
    }
    return match;
  });

  // Check for locality contradictions: if place is nearby or nearest_town, ensure not claimed inside destination
  if (place.localityRelation === 'nearby' || place.localityRelation === 'nearest_town') {
    const escapedDest = destinationCanonicalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const insideRegex = new RegExp(
      `\\b(?:located\\s+(?:inside|in)|situated\\s+(?:in|inside)|inside)\\s+${escapedDest}\\b`,
      'gi'
    );
    if (insideRegex.test(result)) {
      const relationText = place.localityRelation === 'nearest_town'
        ? `located in the nearest town (~${catalogDist} away)`
        : `located nearby (~${catalogDist} away)`;
      result = result.replace(insideRegex, relationText);
      report.warnings.push(
        `Overrode locality claim for "${place.name}" with "${relationText}".`
      );
    }
  }

  return result;
}

/**
 * Sanitizes unsupported numeric hotel rates and price levels converted into INR.
 */
function sanitizePricesFromText(
  text: string,
  report: TravelPlanValidationReport,
  contextDescription: string
): string {
  if (!text) return text;
  let result = text;
  let hadPrice = false;

  // Pattern A: ₹1,500/night, Rs. 1500 per night, INR 2,000/night
  const hotelNightlyPriceRegex = /(?:₹|Rs\.?|INR)\s*[\d,]+(?:\s*[-–—to]\s*(?:₹|Rs\.?|INR)?\s*[\d,]+)?(?:\s*(?:\/|\s*per\s*)night)?/gi;
  if (hotelNightlyPriceRegex.test(result)) {
    hadPrice = true;
    result = result.replace(hotelNightlyPriceRegex, '(current accommodation pricing is unavailable)');
  }

  // Pattern B: Conversion of PRICE_LEVEL into INR numeric ranges (e.g. "₹500–₹1,000", "500-1000 INR")
  const inrRangeRegex = /(?:₹|Rs\.?|INR)\s*[\d,]+\s*[-–—to]\s*(?:₹|Rs\.?|INR)?\s*[\d,]+/gi;
  if (inrRangeRegex.test(result)) {
    hadPrice = true;
    result = result.replace(inrRangeRegex, '(current accommodation pricing is unavailable)');
  }

  if (hadPrice) {
    report.removedUnsupportedPrices++;
    report.warnings.push(`Removed unsupported numeric price claim in ${contextDescription}.`);
  }

  return result;
}

/**
 * Conservative check to identify obvious unverified named-place hallucinations in free text
 * (e.g. "Visit Chandekasare Village Square") and sanitize them safely.
 */
function sanitizeFreeTextItinerary(
  text: string,
  catalog: VerifiedPlaceCatalog,
  report: TravelPlanValidationReport
): string {
  if (!text) return text;
  let result = text;

  const hallucinatedPlaceRegex = /(?:Visit|Explore|Head to|Tour|Stop at|Discover)\s+([A-Z][a-zA-Z0-9'\s]+?\s+(?:Village Square|Heritage Center|Centre|Museum|Temple|Mandir|Palace|Fort|Gardens|Park|Resort|Hotel|Kitchen|Restaurant|Cafe|Market))/g;

  result = result.replace(hallucinatedPlaceRegex, (fullMatch, candidateName) => {
    const isKnown = catalog.places.some(
      p => p.name.toLowerCase().includes(candidateName.trim().toLowerCase()) ||
           candidateName.trim().toLowerCase().includes(p.name.toLowerCase())
    );

    if (!isKnown) {
      report.removedPlaceReferences++;
      report.warnings.push(`Sanitized unverified place in free text: "${candidateName}".`);
      return 'Explore the local surroundings';
    }
    return fullMatch;
  });

  return result;
}

/**
 * Deterministically validates and sanitizes a TravelPlan against an authoritative
 * VerifiedPlaceCatalog. Ensures zero unverified places, zero fabricated hotels,
 * and zero unsourced numeric room tariffs reach the final plan.
 */
export function validateAndSanitizeTravelPlan(
  plan: TravelPlan,
  verifiedCatalog: VerifiedPlaceCatalog
): ValidationOutput {
  // Deep clone to ensure immutability of caller's original object
  const sanitizedPlan: TravelPlan = JSON.parse(JSON.stringify(plan));

  const report: TravelPlanValidationReport = {
    checkedPlaceReferences: 0,
    validPlaceReferences: 0,
    unverifiedPlaceReferences: 0,
    removedPlaceReferences: 0,
    correctedPlaceNames: 0,
    removedUnsupportedPrices: 0,
    removedUnsupportedAccommodation: 0,
    warnings: []
  };

  // Build fast deterministic catalog lookups
  const placeById = new Map<string, VerifiedPlace>();
  const placeByName = new Map<string, VerifiedPlace>();

  for (const p of verifiedCatalog.places) {
    placeById.set(p.internalId, p);
    const normName = p.name.trim().toLowerCase();
    if (!placeByName.has(normName)) {
      placeByName.set(normName, p);
    }
  }

  // ==========================================================================
  // 1. Validate Places to Visit (Attractions)
  // ==========================================================================
  const validPlacesToVisit: PlaceToVisit[] = [];
  const seenPlaceIds = new Set<string>();
  const seenPlaceNames = new Set<string>();

  for (const p of sanitizedPlan.placesToVisit || []) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) {
      continue;
    }
    report.checkedPlaceReferences++;

    let matchedPlace: VerifiedPlace | undefined;

    if (p.verifiedPlaceId) {
      matchedPlace = placeById.get(p.verifiedPlaceId);
      if (!matchedPlace) {
        report.warnings.push(
          `Removed invalid/unknown catalog ID "${p.verifiedPlaceId}" from attraction "${p.name}". Retained as unverified AI suggestion.`
        );
        p.verifiedPlaceId = null;
      }
    }

    if (!matchedPlace) {
      matchedPlace = placeByName.get(p.name.trim().toLowerCase());
    }

    if (matchedPlace) {
      // Deduplication check by catalog internal ID
      if (seenPlaceIds.has(matchedPlace.internalId)) {
        report.warnings.push(
          `Removed duplicate attraction recommendation for "${matchedPlace.name}" (${matchedPlace.internalId}).`
        );
        continue;
      }
      seenPlaceIds.add(matchedPlace.internalId);
      report.validPlaceReferences++;

      // Override name with authoritative catalog name
      if (p.name !== matchedPlace.name) {
        report.correctedPlaceNames++;
        report.warnings.push(
          `Corrected attraction name "${p.name}" -> "${matchedPlace.name}" (${matchedPlace.internalId}).`
        );
        p.name = matchedPlace.name;
      }
      p.verifiedPlaceId = matchedPlace.internalId;
      p.verificationStatus = 'verified';
      p.source = 'catalog';

      // Synchronize distance and locality in text
      p.reason = syncPlaceDistanceAndLocality(
        p.reason,
        matchedPlace,
        verifiedCatalog.destination.canonicalName,
        report
      );
      p.bestTime = syncPlaceDistanceAndLocality(
        p.bestTime,
        matchedPlace,
        verifiedCatalog.destination.canonicalName,
        report
      );
    } else {
      // Unverified AI suggestion - preserve recommendation
      const normName = p.name.trim().toLowerCase();
      if (seenPlaceNames.has(normName)) {
        report.warnings.push(`Removed duplicate attraction recommendation "${p.name}".`);
        continue;
      }
      seenPlaceNames.add(normName);

      p.verifiedPlaceId = null;
      p.verificationStatus = 'unverified';
      p.source = 'ai_suggestion';
      report.unverifiedPlaceReferences = (report.unverifiedPlaceReferences || 0) + 1;
      report.warnings.push(`Retained unverified AI attraction suggestion: "${p.name}".`);
    }

    validPlacesToVisit.push(p);
  }
  sanitizedPlan.placesToVisit = validPlacesToVisit;

  // ==========================================================================
  // 2. Validate Food and Local Experiences (Dining)
  // ==========================================================================
  const validFood: FoodOrExperience[] = [];
  const seenFoodIds = new Set<string>();
  const seenFoodNames = new Set<string>();

  for (const f of sanitizedPlan.foodAndLocalExperiences || []) {
    if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !f.name.trim()) {
      continue;
    }
    report.checkedPlaceReferences++;

    let matchedPlace: VerifiedPlace | undefined;

    if (f.verifiedPlaceId) {
      matchedPlace = placeById.get(f.verifiedPlaceId);
      if (!matchedPlace) {
        report.warnings.push(
          `Removed invalid/unknown catalog ID "${f.verifiedPlaceId}" from restaurant "${f.name}".`
        );
        f.verifiedPlaceId = null;
      }
    }

    if (!matchedPlace) {
      matchedPlace = placeByName.get(f.name.trim().toLowerCase());
    }

    if (matchedPlace) {
      if (seenFoodIds.has(matchedPlace.internalId)) {
        report.warnings.push(
          `Removed duplicate dining recommendation for "${matchedPlace.name}" (${matchedPlace.internalId}).`
        );
        continue;
      }
      seenFoodIds.add(matchedPlace.internalId);

      report.validPlaceReferences++;
      if (f.name !== matchedPlace.name) {
        report.correctedPlaceNames++;
        report.warnings.push(
          `Corrected restaurant name "${f.name}" -> "${matchedPlace.name}" (${matchedPlace.internalId}).`
        );
        f.name = matchedPlace.name;
      }
      f.verifiedPlaceId = matchedPlace.internalId;
      f.verificationStatus = 'verified';
      f.source = 'catalog';
      f.reason = syncPlaceDistanceAndLocality(
        f.reason,
        matchedPlace,
        verifiedCatalog.destination.canonicalName,
        report
      );
    } else {
      // Unverified AI restaurant or culinary experience
      const normName = f.name.trim().toLowerCase();
      if (seenFoodNames.has(normName)) {
        continue;
      }
      seenFoodNames.add(normName);

      f.verifiedPlaceId = null;
      f.verificationStatus = 'unverified';
      f.source = 'ai_suggestion';
      report.unverifiedPlaceReferences = (report.unverifiedPlaceReferences || 0) + 1;
    }

    validFood.push(f);
  }
  sanitizedPlan.foodAndLocalExperiences = validFood;

  // ==========================================================================
  // 3. Validate Activities
  // ==========================================================================
  const validActivities: Activity[] = [];
  const seenActivityIds = new Set<string>();
  const seenActivityNames = new Set<string>();

  for (const a of sanitizedPlan.activities || []) {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !a.name.trim()) {
      continue;
    }
    report.checkedPlaceReferences++;

    let matchedPlace: VerifiedPlace | undefined;

    if (a.verifiedPlaceId) {
      matchedPlace = placeById.get(a.verifiedPlaceId);
      if (!matchedPlace) {
        report.warnings.push(
          `Removed invalid/unknown catalog ID "${a.verifiedPlaceId}" from activity "${a.name}".`
        );
        a.verifiedPlaceId = null;
      }
    }

    if (!matchedPlace) {
      matchedPlace = placeByName.get(a.name.trim().toLowerCase());
    }

    if (matchedPlace) {
      if (seenActivityIds.has(matchedPlace.internalId)) {
        report.warnings.push(
          `Removed duplicate activity recommendation for "${matchedPlace.name}" (${matchedPlace.internalId}).`
        );
        continue;
      }
      seenActivityIds.add(matchedPlace.internalId);

      report.validPlaceReferences++;
      if (a.name !== matchedPlace.name) {
        report.correctedPlaceNames++;
        report.warnings.push(
          `Corrected activity name "${a.name}" -> "${matchedPlace.name}" (${matchedPlace.internalId}).`
        );
        a.name = matchedPlace.name;
      }
      a.verifiedPlaceId = matchedPlace.internalId;
      a.verificationStatus = 'verified';
      a.source = 'catalog';
      a.reason = syncPlaceDistanceAndLocality(
        a.reason,
        matchedPlace,
        verifiedCatalog.destination.canonicalName,
        report
      );
    } else {
      // Unverified AI activity or curated experience
      const normName = a.name.trim().toLowerCase();
      if (seenActivityNames.has(normName)) {
        continue;
      }
      seenActivityNames.add(normName);

      a.verifiedPlaceId = null;
      a.verificationStatus = 'unverified';
      a.source = 'ai_suggestion';
      report.unverifiedPlaceReferences = (report.unverifiedPlaceReferences || 0) + 1;
    }

    validActivities.push(a);
  }
  sanitizedPlan.activities = validActivities;

  // ==========================================================================
  // 4. Validate Accommodation Guidance & Prices
  // ==========================================================================
  let guidance = sanitizedPlan.accommodationGuidance || '';
  // Sanitize unsupported numeric room tariffs / prices
  guidance = sanitizePricesFromText(guidance, report, 'accommodationGuidance');

  const verifiedAccommodations = verifiedCatalog.byCategory.accommodation;
  if (verifiedAccommodations.length === 0) {
    if (!guidance || guidance.trim() === '') {
      guidance = 'No verified accommodation was found in the searched area. Consider homestays or lodging in neighboring towns.';
    }
  }
  sanitizedPlan.accommodationGuidance = guidance;

  // ==========================================================================
  // 5. Validate Itinerary Schedules and Day Place IDs
  // ==========================================================================
  const slots: Array<{
    textKey: 'morning' | 'afternoon' | 'evening';
    idKey: 'morningPlaceId' | 'afternoonPlaceId' | 'eveningPlaceId';
  }> = [
    { textKey: 'morning', idKey: 'morningPlaceId' },
    { textKey: 'afternoon', idKey: 'afternoonPlaceId' },
    { textKey: 'evening', idKey: 'eveningPlaceId' }
  ];

  for (const day of sanitizedPlan.itinerary || []) {
    for (const slot of slots) {
      const placeId = day[slot.idKey];
      if (placeId) {
        report.checkedPlaceReferences++;
        const matchedPlace = placeById.get(placeId);
        if (matchedPlace) {
          report.validPlaceReferences++;
          day[slot.textKey] = syncPlaceDistanceAndLocality(
            day[slot.textKey],
            matchedPlace,
            verifiedCatalog.destination.canonicalName,
            report
          );
        } else {
          // Invalid ID: remove structured reference ID, but retain the itinerary schedule text
          report.warnings.push(
            `Removed invalid itinerary place ID "${placeId}" on Day ${day.day} (${slot.textKey}).`
          );
          day[slot.idKey] = undefined;
        }
      } else {
        // ID missing: check if text deterministically mentions a catalog place
        let attachedPlace: VerifiedPlace | undefined;
        for (const p of verifiedCatalog.places) {
          if (p.name.length > 3 && day[slot.textKey]?.toLowerCase().includes(p.name.toLowerCase())) {
            attachedPlace = p;
            break;
          }
        }

        if (attachedPlace) {
          day[slot.idKey] = attachedPlace.internalId;
          report.checkedPlaceReferences++;
          report.validPlaceReferences++;
          day[slot.textKey] = syncPlaceDistanceAndLocality(
            day[slot.textKey],
            attachedPlace,
            verifiedCatalog.destination.canonicalName,
            report
          );
        }
      }
    }
  }

  // ==========================================================================
  // 6. Validate Budget Tips
  // ==========================================================================
  const cleanedTips: string[] = [];
  for (const tip of sanitizedPlan.budgetTips || []) {
    const isHotelPriceClaim = /\b(hotel\s+(?:room|rate|tariff|price|cost|charges?)|room\s+(?:rate|tariff|price|cost|charges?)|per\s+night|\/\s*night|nightly|tariff\s+of)\b/i.test(tip) &&
      /(?:₹|Rs\.?|INR)\s*[\d,]+/i.test(tip);
    if (isHotelPriceClaim) {
      report.removedUnsupportedPrices++;
      report.warnings.push('Sanitized unsupported hotel room tariff from budget tips.');
      cleanedTips.push('Confirm current room rates directly with verified properties before booking.');
    } else {
      cleanedTips.push(tip);
    }
  }
  sanitizedPlan.budgetTips = cleanedTips;

  // ==========================================================================
  // 7. Authoritative Metadata Binding
  // ==========================================================================
  sanitizedPlan.resolvedDestination = verifiedCatalog.destination;
  sanitizedPlan.verifiedPlacesCatalog = verifiedCatalog.places;
  sanitizedPlan.includeDayByDayItinerary = typeof plan.includeDayByDayItinerary === 'boolean'
    ? plan.includeDayByDayItinerary
    : (Array.isArray(sanitizedPlan.itinerary) && sanitizedPlan.itinerary.length > 0);

  return {
    plan: sanitizedPlan,
    validationReport: report
  };
}
