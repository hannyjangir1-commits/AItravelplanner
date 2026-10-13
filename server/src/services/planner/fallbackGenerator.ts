import {
  TravelPlan,
  GeneratePlanRequest,
  PlaceToVisit,
  FoodOrExperience,
  Activity,
  DayPlan
} from '../../types.js';
import { VerifiedPlaceCatalog } from '../placeCatalog.js';

/**
 * Deterministic catalog-grounded fallback generator.
 * Strictly uses catalog items when available and authentic generic suggestions when missing.
 * Never fabricates venue names, street addresses, or room tariffs.
 * Respects includeDayByDayItinerary flag (empty array when false).
 */
export function generateCatalogGroundedFallback(
  req: GeneratePlanRequest,
  catalog: VerifiedPlaceCatalog
): TravelPlan {
  const days = Math.min(Math.max(Number(req.numberOfDays) || 1, 1), 30);
  const dest = catalog.destination.canonicalName || req.destination.trim();
  const stay = (req.accommodationPreference || 'Moderate').toLowerCase();
  const pace = (req.activityLevel || 'Moderate').toLowerCase();
  const travellers = Number(req.numberOfTravellers) || 1;
  const totalBudget = Number(req.budgetInr) || 0;
  const dailyBudget = Math.round(totalBudget / days);
  const dailyBudgetFmt = `₹${dailyBudget.toLocaleString('en-IN')}`;

  const accommodations = catalog.byCategory.accommodation;
  const attractions = catalog.byCategory.attraction;
  const restaurants = catalog.byCategory.restaurant;
  const activities = catalog.byCategory.activity;

  // Accommodation guidance: strictly honest
  let accommodationGuidance: string;
  if (accommodations.length > 0) {
    const hotelSummary = accommodations.map((a) => {
      const distKm = (a.distanceMeters / 1000).toFixed(1);
      const locText = a.localityRelation === 'exact_destination' ? 'in destination' : `${distKm} km away (${a.localityRelation.replace('_', ' ')})`;
      return `${a.name} (${locText}${a.rating ? `, ⭐ ${a.rating}` : ''})`;
    }).join('; ');
    accommodationGuidance = `Verified accommodations identified for your ${stay} stay: ${hotelSummary}. Check current seasonal room rates directly before booking.`;
  } else {
    accommodationGuidance = `No verified commercial accommodation options were found in the searched area.`;
  }

  // Places to visit: only genuine attractions from catalog
  const placesToVisit: PlaceToVisit[] = attractions.map((attr) => {
    const distKm = (attr.distanceMeters / 1000).toFixed(1);
    const locText = attr.localityRelation === 'exact_destination' ? 'at destination' : `~${distKm} km away (${attr.localityRelation.replace('_', ' ')})`;
    return {
      verifiedPlaceId: attr.internalId,
      name: attr.name,
      reason: `Verified ${attr.primaryCategory} located ${locText}.${attr.rating ? ` Rated ${attr.rating} by visitors.` : ''}`,
      bestTime: 'Morning or late afternoon',
      verificationStatus: 'verified',
      source: 'catalog'
    };
  });

  // Food and local experiences: verified restaurants or genuine regional culinary guidance
  const foodAndLocalExperiences: FoodOrExperience[] = [];
  if (restaurants.length > 0) {
    for (const rest of restaurants) {
      const distKm = (rest.distanceMeters / 1000).toFixed(1);
      const locText = rest.localityRelation === 'exact_destination' ? 'at destination' : `~${distKm} km away`;
      foodAndLocalExperiences.push({
        verifiedPlaceId: rest.internalId,
        name: rest.name,
        reason: `Verified dining establishment located ${locText}.${rest.rating ? ` Rated ${rest.rating}.` : ''}`,
        verificationStatus: 'verified',
        source: 'catalog'
      });
    }
  } else {
    foodAndLocalExperiences.push({
      name: `Traditional Regional Cuisine of ${dest}`,
      reason: `Enjoy freshly prepared local homestyle meals and traditional regional specialties.`,
      verificationStatus: 'unverified',
      source: 'ai_suggestion'
    });
  }

  // Activities: verified activities or generic sightseeing/walking activities (NO fabricated venue names)
  const activityList: Activity[] = [];
  if (activities.length > 0) {
    for (const act of activities) {
      activityList.push({
        verifiedPlaceId: act.internalId,
        name: act.name,
        reason: `Verified local venue/activity matching your ${pace} pace.`,
        verificationStatus: 'verified',
        source: 'catalog'
      });
    }
  } else {
    activityList.push({
      name: `Walking Discovery of ${dest}`,
      reason: `Explore the local neighborhood paths and rural landscapes at an unhurried ${pace} pace.`,
      verificationStatus: 'unverified',
      source: 'ai_suggestion'
    });
    activityList.push({
      name: `Sunset Viewing & Scenic Relaxation`,
      reason: `Unwind outdoors enjoying local vistas and fresh air.`,
      verificationStatus: 'unverified',
      source: 'ai_suggestion'
    });
  }

  // Build day-by-day itinerary strictly referencing verified places
  const itinerary: DayPlan[] = [];
  const shouldIncludeItinerary = req.includeDayByDayItinerary !== false;

  if (shouldIncludeItinerary) {
    let attractionIndex = 0;
    let restaurantIndex = 0;

    for (let dayNum = 1; dayNum <= days; dayNum++) {
      let morningActivity = '';
      let morningPlaceId: string | undefined = undefined;
      let afternoonActivity = '';
      let afternoonPlaceId: string | undefined = undefined;
      let eveningActivity = '';
      let eveningPlaceId: string | undefined = undefined;

      // Morning
      if (attractions.length > 0) {
        const morningAttr = attractions[attractionIndex % attractions.length];
        attractionIndex++;
        morningActivity = `Visit ${morningAttr.name} to explore the grounds and take in local sights at an unhurried ${pace} pace.`;
        morningPlaceId = morningAttr.internalId;
      } else {
        morningActivity = `Morning exploration and scenic neighborhood walk around ${dest}.`;
      }

      // Afternoon
      if (restaurants.length > 0) {
        const lunchRest = restaurants[restaurantIndex % restaurants.length];
        restaurantIndex++;
        afternoonActivity = `Enjoy a leisurely local lunch at ${lunchRest.name}, followed by quiet exploration or rest.`;
        afternoonPlaceId = lunchRest.internalId;
      } else {
        afternoonActivity = `Local lunch in ${dest} followed by a relaxing afternoon exploring neighborhood artisan shops.`;
      }

      // Evening
      if (attractions.length > attractionIndex) {
        const eveningAttr = attractions[attractionIndex % attractions.length];
        attractionIndex++;
        eveningActivity = `Late afternoon stroll and sunset viewing near ${eveningAttr.name}.`;
        eveningPlaceId = eveningAttr.internalId;
      } else {
        eveningActivity = `Evening relaxation, sunset views, and dinner featuring authentic local homestyle cuisine.`;
      }

      itinerary.push({
        day: dayNum,
        morning: morningActivity,
        morningPlaceId,
        afternoon: afternoonActivity,
        afternoonPlaceId,
        evening: eveningActivity,
        eveningPlaceId,
        notes: `Day ${dayNum} of ${days}: Target daily budget allocation ${dailyBudgetFmt} for ${travellers} traveler${travellers > 1 ? 's' : ''}.`,
        alternative: `In case of inclement weather, visit indoor local cafes or relax at your stay.`
      });
    }
  }

  return {
    accommodationGuidance,
    placesToVisit,
    foodAndLocalExperiences,
    activities: activityList,
    weatherAdvice: `Check current seasonal forecasts for ${dest}. Pack breathable layers and comfortable walking shoes.`,
    budgetTips: [
      `Allocate approximately ${dailyBudgetFmt} per day across food, transport, and entry tickets for your ${travellers} traveler${travellers > 1 ? 's' : ''}.`,
      `Prefer local public transit or pre-negotiated auto rickshaws over hailing on-demand cabs.`,
      `Dine at local eateries for authentic flavor and significant budget savings.`
    ],
    itinerary,
    includeDayByDayItinerary: shouldIncludeItinerary
  };
}
