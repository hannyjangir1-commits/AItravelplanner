import { useState, useEffect, useCallback } from 'react';
import type { TravelPlan, TripFormData, UserProfile, ItinerarySummary, SavedItineraryDetail } from './types';
import { generateTravelPlan, modifyTravelPlan, fetchCurrentUser, fetchTravelPlans, fetchTravelPlanById } from './api';
import { Header } from './components/Header';
import { HeroLanding } from './components/HeroLanding';
import { TravelForm } from './components/TravelForm';
import { PlanResult } from './components/PlanResult';
import { PreviousItineraries } from './components/PreviousItineraries';

import {
  loadStoredSession,
  saveAppSessionStorage,
  clearAppSessionStorage,
  checkAndClearJustModifiedFlag,
  type StoredSessionState
} from './storage';

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [initialSession] = useState<StoredSessionState>(() => loadStoredSession());
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(initialSession.plan);
  const [currentTripDetails, setCurrentTripDetails] = useState<TripFormData | null>(initialSession.details);
  const [isDemoPlan, setIsDemoPlan] = useState<boolean>(initialSession.isDemo);
  const [planMessage, setPlanMessage] = useState<string | null>(initialSession.message);

  // Previous Itineraries state
  const [savedItineraries, setSavedItineraries] = useState<ItinerarySummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [openedSavedItinerary, setOpenedSavedItinerary] = useState<SavedItineraryDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch authenticated user profile on application startup
  useEffect(() => {
    fetchCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {
        setUser(null);
      });
  }, []);

  // History loading callback
  const loadHistory = useCallback(async () => {
    if (!user) {
      setSavedItineraries([]);
      return;
    }
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const list = await fetchTravelPlans();
      setSavedItineraries(list);
    } catch {
      setHistoryError('Unable to load previous itineraries.');
    } finally {
      setIsLoadingHistory(false);
    }
  }, [user]);

  // Load history when authenticated user state changes
  useEffect(() => {
    if (user) {
      loadHistory();
    } else {
      setSavedItineraries([]);
      setOpenedSavedItinerary(null);
    }
  }, [user, loadHistory]);

  const [isLoading, setIsLoading] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [showModifiedSuccess, setShowModifiedSuccess] = useState(false);

  // Check if page just reloaded after a modification
  useEffect(() => {
    if (checkAndClearJustModifiedFlag()) {
      setShowModifiedSuccess(true);

      // Prevent browser from restoring scroll position to bottom
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }

      // Smoothly scroll to the very start of the plan
      const timer = setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 120);

      return () => clearTimeout(timer);
    }
  }, []);

  const scrollToForm = () => {
    const el = document.getElementById('travel-form-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleGeneratePlan = async (formData: TripFormData) => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await generateTravelPlan(formData);
      setCurrentPlan(response.plan);
      setCurrentTripDetails(formData);
      setIsDemoPlan(response.isDemo);
      setPlanMessage(response.message || null);

      // Safely persist to sessionStorage
      saveAppSessionStorage(response.plan, formData, response.isDemo, response.message);

      // Refresh the history list so newly saved plan appears
      if (user) {
        loadHistory();
      }

      // Smooth scroll to results
      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while generating your travel plan. Please check your network and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleModifyPlan = async (modificationRequest: string) => {
    if (isModifying || !currentTripDetails || !currentPlan) return;

    setIsModifying(true);
    setModifyError(null);

    try {
      const response = await modifyTravelPlan(currentTripDetails, currentPlan, modificationRequest);

      // Save updated plan in session storage so it persists across manual page refreshes
      saveAppSessionStorage(response.plan, currentTripDetails, response.isDemo, response.message);

      // Instantaneous in-place state update without an expensive browser page reload
      setCurrentPlan(response.plan);
      setIsDemoPlan(response.isDemo);
      setPlanMessage(response.message || null);
      setShowModifiedSuccess(true);
      setIsModifying(false);

      // Smoothly scroll to the very start of the updated plan
      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    } catch (err: any) {
      setModifyError(err.message || 'Failed to update travel plan. Please try again.');
      setIsModifying(false);
    }
  };

  const handleSelectPreviousItinerary = async (id: string) => {
    if (loadingDetailId) return;
    setLoadingDetailId(id);
    setDetailError(null);
    try {
      const detail = await fetchTravelPlanById(id);
      setOpenedSavedItinerary(detail);
      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    } catch (err: any) {
      setDetailError(err.message || 'Unable to load itinerary.');
    } finally {
      setLoadingDetailId(null);
    }
  };

  const handleBackToHistory = () => {
    setOpenedSavedItinerary(null);
    setDetailError(null);
    setTimeout(() => {
      const el = document.getElementById('previous-itineraries-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  const handleModifyOpenedPlan = async (modificationRequest: string) => {
    if (isModifying || !openedSavedItinerary) return;
    setIsModifying(true);
    setModifyError(null);

    try {
      const tripFormData: TripFormData = {
        destination: openedSavedItinerary.destination,
        numberOfDays: openedSavedItinerary.numberOfDays,
        budgetInr: openedSavedItinerary.budgetInr,
        numberOfTravellers: openedSavedItinerary.numberOfTravellers,
        interests: openedSavedItinerary.interests,
        accommodationPreference: openedSavedItinerary.accommodationPreference,
        activityLevel: openedSavedItinerary.activityLevel,
        additionalNotes: openedSavedItinerary.additionalNotes || ''
      };

      const response = await modifyTravelPlan(tripFormData, openedSavedItinerary.plan, modificationRequest);
      setOpenedSavedItinerary({
        ...openedSavedItinerary,
        plan: response.plan
      });
      setShowModifiedSuccess(true);
      setIsModifying(false);

      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    } catch (err: any) {
      setModifyError(err.message || 'Failed to update travel plan. Please try again.');
      setIsModifying(false);
    }
  };

  const handleStartNewPlan = () => {
    clearAppSessionStorage();
    setCurrentPlan(null);
    setCurrentTripDetails(null);
    setOpenedSavedItinerary(null);
    setDetailError(null);
    setIsDemoPlan(false);
    setPlanMessage(null);
    setErrorMessage(null);
    setModifyError(null);
    setShowModifiedSuccess(false);
    scrollToForm();
  };

  return (
    <div className="app-layout" id="top">
      <a href="#main-content" className="skip-to-content-link">
        Skip to main content
      </a>
      <Header
        onNewPlan={handleStartNewPlan}
        hasPlan={Boolean(currentPlan || openedSavedItinerary)}
        user={user}
        onUpdateUser={setUser}
        onLogout={() => {
          setUser(null);
          setSavedItineraries([]);
          setOpenedSavedItinerary(null);
          setDetailError(null);
        }}
      />

      <main id="main-content" tabIndex={-1}>
        {!currentPlan && !openedSavedItinerary && <HeroLanding onPlanClick={scrollToForm} />}

        {!openedSavedItinerary && (
          <div id="travel-form-section">
            <TravelForm
              onSubmit={handleGeneratePlan}
              isLoading={isLoading}
              errorMessage={errorMessage}
              onDismissError={() => setErrorMessage(null)}
            />
          </div>
        )}

        {user && !openedSavedItinerary && (
          <div id="previous-itineraries-section">
            <PreviousItineraries
              itineraries={savedItineraries}
              isLoading={isLoadingHistory}
              error={historyError}
              onSelectItinerary={handleSelectPreviousItinerary}
              loadingId={loadingDetailId}
            />
          </div>
        )}

        {detailError && !openedSavedItinerary && (
          <div className="container" style={{ marginBottom: '1.5rem' }}>
            <div className="alert-box alert-error" role="alert">
              {detailError}
            </div>
          </div>
        )}

        {openedSavedItinerary ? (
          <div>
            <PlanResult
              plan={openedSavedItinerary.plan}
              tripDetails={{
                destination: openedSavedItinerary.destination,
                numberOfDays: openedSavedItinerary.numberOfDays,
                budgetInr: openedSavedItinerary.budgetInr,
                numberOfTravellers: openedSavedItinerary.numberOfTravellers,
                interests: openedSavedItinerary.interests,
                accommodationPreference: openedSavedItinerary.accommodationPreference,
                activityLevel: openedSavedItinerary.activityLevel,
                additionalNotes: openedSavedItinerary.additionalNotes || ''
              }}
              isDemo={false}
              onModify={handleModifyOpenedPlan}
              isModifying={isModifying}
              modifyError={modifyError}
              onPlanAnother={() => {
                setOpenedSavedItinerary(null);
                scrollToForm();
              }}
              showModifiedSuccess={showModifiedSuccess}
              onDismissSuccess={() => setShowModifiedSuccess(false)}
              onBackToHistory={handleBackToHistory}
            />
          </div>
        ) : (
          currentPlan && currentTripDetails && (
            <div>
              <PlanResult
                plan={currentPlan}
                tripDetails={currentTripDetails}
                isDemo={isDemoPlan}
                planMessage={planMessage}
                onModify={handleModifyPlan}
                isModifying={isModifying}
                modifyError={modifyError}
                onPlanAnother={scrollToForm}
                showModifiedSuccess={showModifiedSuccess}
                onDismissSuccess={() => setShowModifiedSuccess(false)}
              />
            </div>
          )
        )}
      </main>

      <footer className="enterprise-footer">
        <div className="container footer-inner">
          <div>
            <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '1rem', marginBottom: '0.25rem' }}>
              TravelGenie &bull; Enterprise Destination Planner
            </div>
            <p className="footer-disclaimer">
              Tailored destination intelligence, accommodations, culinary heritage, activities, and day-by-day schedules.{isDemoPlan ? ' Currently displaying demo fallback plan.' : ' Powered by Google Gemini AI.'} All recommendations and budget calculations are advisory estimates.
            </p>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            &copy; {new Date().getFullYear()} TravelGenie. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
