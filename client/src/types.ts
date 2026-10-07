export interface PlaceToVisit {
  name: string;
  reason: string;
  bestTime: string;
}

export interface FoodOrExperience {
  name: string;
  reason: string;
}

export interface Activity {
  name: string;
  reason: string;
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
  generatedAt?: string;
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
  plan: TravelPlan;
  createdAt: string;
  updatedAt: string;
}
