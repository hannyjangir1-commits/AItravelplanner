import type { ResolvedDestination } from './services/destinationResolver.js';

export type PlaceVerificationStatus = 'verified' | 'unverified';
export type PlaceSource = 'catalog' | 'ai_suggestion';

export interface PlaceToVisit {
  verifiedPlaceId?: string | null;
  name: string;
  reason: string;
  bestTime: string;
  verificationStatus?: PlaceVerificationStatus;
  source?: PlaceSource;
}

export interface FoodOrExperience {
  verifiedPlaceId?: string | null;
  name: string;
  reason: string;
  verificationStatus?: PlaceVerificationStatus;
  source?: PlaceSource;
}

export interface Activity {
  verifiedPlaceId?: string | null;
  name: string;
  reason: string;
  verificationStatus?: PlaceVerificationStatus;
  source?: PlaceSource;
}

export interface DayPlan {
  day: number;
  morning: string;
  morningPlaceId?: string;
  afternoon: string;
  afternoonPlaceId?: string;
  evening: string;
  eveningPlaceId?: string;
  notes: string;
  alternative: string;
}

export interface TravelPlan {
  accommodationGuidance: string;
  placesToVisit: PlaceToVisit[];
  foodAndLocalExperiences: FoodOrExperience[];
  activities: Activity[];
  weatherAdvice: string;
  budgetTips: string[];
  itinerary: DayPlan[];
  includeDayByDayItinerary?: boolean;
  generatedAt?: string;
  resolvedDestination?: ResolvedDestination;
  verifiedPlacesCatalog?: VerifiedPlace[];
}


export interface GeneratePlanRequest {
  destination: string;
  numberOfDays: number;
  budgetInr: number;
  numberOfTravellers: number;
  interests: string[];
  accommodationPreference: 'Budget' | 'Moderate' | 'Premium';
  activityLevel: 'Relaxed' | 'Moderate' | 'Active';
  additionalNotes?: string;
  includeDayByDayItinerary?: boolean;
}

export interface ModifyPlanRequest {
  originalDetails: GeneratePlanRequest;
  currentPlan: TravelPlan;
  modificationRequest: string;
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
}

export interface UserProfile {
  id: string;
  username: string;
  name?: string | null;
  place?: string | null;
}

export type LocalityRelation = 'exact_destination' | 'nearby' | 'nearest_town';

export type PriceStatus = 'PRICE_UNAVAILABLE' | 'PRICE_LEVEL_ONLY' | 'ESTIMATED_BUDGET_RANGE';

export type PlacePrimaryCategory = 'accommodation' | 'attraction' | 'restaurant' | 'activity' | 'poi';

export interface VerifiedPlaceLocation {
  latitude: number;
  longitude: number;
}

/**
 * Normalized verified place representation backed strictly by real-world provider data.
 * Zero values are fabricated or guessed.
 */
export interface VerifiedPlace {
  internalId: string;
  provider: 'openstreetmap' | 'google_places';
  providerPlaceId: string;
  name: string;
  primaryCategory: PlacePrimaryCategory;
  types: string[];
  formattedAddress: string;
  location: VerifiedPlaceLocation;
  distanceMeters: number;
  localityRelation: LocalityRelation;
  rating: number | null;
  userRatingCount: number | null;
  googleMapsUri: string | null;
  websiteUri: string | null;
  phoneNumber: string | null;
  openingHours: string[] | null;
  priceLevel: string | null;
  priceStatus: PriceStatus;
  estimatedPriceInrRange: { min: number; max: number } | null;
  verificationTimestamp: string;
  attribution?: string;
}

