import type { TravelPlan, TripFormData, ApiResponse } from './types';

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
