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
  afternoon: string;
  evening: string;
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
  resolvedDestination?: {
    canonicalName: string;
    formattedAddress: string;
    originalInput?: string;
  };
}

export type AccommodationType = 'Budget' | 'Moderate' | 'Premium';
export type ActivityLevelType = 'Relaxed' | 'Moderate' | 'Active';

export interface TripFormData {
  destination: string;
  numberOfDays: number | '';
  budgetInr: number | '';
  numberOfTravellers: number | '';
  interests: string[];
  accommodationPreference: AccommodationType;
  activityLevel: ActivityLevelType;
  additionalNotes: string;
  includeDayByDayItinerary?: boolean;
}

export interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  isDemo?: boolean;
  message?: string;
  error?: string;
}

export interface UserProfile {
  id: string;
  username: string;
  name?: string | null;
  email?: string | null;
  profilePicture?: string | null;
  place?: string | null;
}

export interface ItinerarySummary {
  id: string;
  destination: string;
  numberOfDays: number;
  numberOfTravellers: number;
  createdAt: string;
}

export interface SavedItineraryDetail {
  id: string;
  destination: string;
  numberOfDays: number;
  budgetInr: number;
  numberOfTravellers: number;
  interests: string[];
  accommodationPreference: AccommodationType;
  activityLevel: ActivityLevelType;
  additionalNotes: string | null;
  includeDayByDayItinerary?: boolean;
  plan: TravelPlan;
  createdAt: string;
  updatedAt: string;
}
