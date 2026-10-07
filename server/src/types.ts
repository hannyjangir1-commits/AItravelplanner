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

export interface GeneratePlanRequest {
  destination: string;
  numberOfDays: number;
  budgetInr: number;
  numberOfTravellers: number;
  interests: string[];
  accommodationPreference: 'Budget' | 'Moderate' | 'Premium';
  activityLevel: 'Relaxed' | 'Moderate' | 'Active';
  additionalNotes?: string;
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
