import type { TravelPlan, TripFormData, ApiResponse, UserProfile, ItinerarySummary, SavedItineraryDetail } from './types';

export async function generateTravelPlan(formData: TripFormData): Promise<{ plan: TravelPlan; isDemo: boolean; message?: string }> {
  const payload = {
    destination: formData.destination.trim(),
    numberOfDays: Number(formData.numberOfDays),
    budgetInr: Number(formData.budgetInr),
    numberOfTravellers: Number(formData.numberOfTravellers),
    interests: formData.interests,
    accommodationPreference: formData.accommodationPreference,
    activityLevel: formData.activityLevel,
    additionalNotes: formData.additionalNotes.trim() || undefined
  };

  let response: Response;
  try {
    response = await fetch('/api/generate-travel-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Unable to connect to the travel planning service. Please verify your network connection and ensure the server is active.');
  }

  let data: ApiResponse<TravelPlan>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The server responded with an unexpected status (${response.status}). Please try again in a few moments.`);
  }

  if (!response.ok || !data.data) {
    throw new Error(data.error || `Failed to generate travel plan (Status ${response.status}).`);
  }

  return {
    plan: {
      ...data.data,
      generatedAt: data.data.generatedAt || new Date().toISOString()
    },
    isDemo: Boolean(data.isDemo),
    message: data.message
  };
}

export async function modifyTravelPlan(
  originalDetails: TripFormData,
  currentPlan: TravelPlan,
  modificationRequest: string
): Promise<{ plan: TravelPlan; isDemo: boolean; message?: string }> {
  const payload = {
    originalDetails: {
      destination: originalDetails.destination.trim(),
      numberOfDays: Number(originalDetails.numberOfDays),
      budgetInr: Number(originalDetails.budgetInr),
      numberOfTravellers: Number(originalDetails.numberOfTravellers),
      interests: originalDetails.interests,
      accommodationPreference: originalDetails.accommodationPreference,
      activityLevel: originalDetails.activityLevel,
      additionalNotes: originalDetails.additionalNotes.trim() || undefined
    },
    currentPlan,
    modificationRequest: modificationRequest.trim()
  };

  let response: Response;
  try {
    response = await fetch('/api/modify-travel-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Unable to connect to the travel planning service. Please verify your network connection and ensure the server is active.');
  }

  let data: ApiResponse<TravelPlan>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The server responded with an unexpected status (${response.status}). Please try again in a few moments.`);
  }

  if (!response.ok || !data.data) {
    throw new Error(data.error || `Failed to update travel plan (Status ${response.status}).`);
  }

  return {
    plan: {
      ...data.data,
      generatedAt: data.data.generatedAt || new Date().toISOString()
    },
    isDemo: Boolean(data.isDemo),
    message: data.message
  };
}

export interface AuthApiError extends Error {
  isNotFound?: boolean;
}

export async function signupUser(username: string, password: string): Promise<UserProfile> {
  let response: Response;
  try {
    response = await fetch('/api/auth/signup', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });
  } catch {
    throw new Error('Unable to connect to the authentication service. Please verify your connection.');
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('Unexpected response from server.');
  }

  if (!response.ok || !data.authenticated || !data.user) {
    throw new Error(data.error || 'Failed to sign up.');
  }

  return data.user as UserProfile;
}

export async function loginUser(username: string, password: string): Promise<UserProfile> {
  let response: Response;
  try {
    response = await fetch('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });
  } catch {
    throw new Error('Unable to connect to the authentication service. Please verify your connection.');
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('Unexpected response from server.');
  }

  if (!response.ok || !data.authenticated || !data.user) {
    const error = new Error(data.error || 'Failed to sign in.') as AuthApiError;
    if (data.notFound) {
      error.isNotFound = true;
    }
    throw error;
  }

  return data.user as UserProfile;
}

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.authenticated && data.user) {
      return data.user as UserProfile;
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateUserProfile(payload: { name?: string; place?: string }): Promise<UserProfile> {
  let response: Response;
  try {
    response = await fetch('/api/auth/profile', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Unable to connect to the profile service. Please verify your network.');
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('Unexpected response from server.');
  }

  if (!response.ok || !data.authenticated || !data.user) {
    throw new Error(data.error || data.message || `Failed to update profile (Status ${response.status}).`);
  }

  return data.user as UserProfile;
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
  } catch (error) {
    console.error('[Logout API Error]:', error);
  }
}

export async function fetchTravelPlans(): Promise<ItinerarySummary[]> {
  let response: Response;
  try {
    response = await fetch('/api/travel-plans', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
  } catch {
    throw new Error('Unable to load previous itineraries.');
  }

  if (!response.ok) {
    throw new Error('Unable to load previous itineraries.');
  }

  const data = await response.json();
  if (Array.isArray(data.itineraries)) {
    return data.itineraries as ItinerarySummary[];
  }
  return [];
}

export async function fetchTravelPlanById(id: string): Promise<SavedItineraryDetail> {
  let response: Response;
  try {
    response = await fetch(`/api/travel-plans/${encodeURIComponent(id)}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
  } catch {
    throw new Error('Unable to load itinerary.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || 'Unable to load itinerary.');
  }

  const data = await response.json();
  if (!data || !data.itinerary) {
    throw new Error('Itinerary not found.');
  }

  return data.itinerary as SavedItineraryDetail;
}
