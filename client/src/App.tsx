import { useState, useEffect, useCallback, useRef } from 'react';
import type { TravelPlan, TripFormData, UserProfile, ItinerarySummary, SavedItineraryDetail } from './types';
import { generateTravelPlan, modifyTravelPlan, fetchCurrentUser, fetchTravelPlans, fetchTravelPlanById, deleteTravelPlan } from './api';
import { Header } from './components/Header';
import { HeroLanding } from './components/HeroLanding';
import { TravelForm } from './components/TravelForm';
import { PlanResult } from './components/PlanResult';
import { PreviousItineraries } from './components/PreviousItineraries';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { TermsOfService } from './components/TermsOfService';
import { AuthPage } from './components/AuthPage';

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
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [currentTripDetails, setCurrentTripDetails] = useState<TripFormData | null>(initialSession.details);
  const [isDemoPlan, setIsDemoPlan] = useState<boolean>(initialSession.isDemo);
  const [planMessage, setPlanMessage] = useState<string | null>(initialSession.message);

  // In-flight request cancellation refs to prevent async race conditions
  const historyAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  // Client-side routing state for public legal pages (/privacy, /terms)
  const [currentRoute, setCurrentRoute] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentRoute(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Previous Itineraries state
  const [savedItineraries, setSavedItineraries] = useState<ItinerarySummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [openedSavedItinerary, setOpenedSavedItinerary] = useState<SavedItineraryDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch authenticated user profile on application startup
  useEffect(() => {
    const abortController = new AbortController();
    fetchCurrentUser({ signal: abortController.signal })
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {
        setUser(null);
      });
    return () => abortController.abort();
  }, []);

  // History loading callback with in-flight cancellation
  const loadHistory = useCallback(async () => {
    if (!user) {
      setSavedItineraries([]);
      return;
    }
    if (historyAbortRef.current) {
      historyAbortRef.current.abort();
    }
    const controller = new AbortController();
    historyAbortRef.current = controller;

    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const list = await fetchTravelPlans({ signal: controller.signal });
      setSavedItineraries(list);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setHistoryError('Unable to load previous itineraries.');
    } finally {
      if (historyAbortRef.current === controller) {
        setIsLoadingHistory(false);
      }
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

    // Immediately clear previous plan display and session storage so previous/stale results never linger
    setCurrentPlan(null);
    setCurrentPlanId(null);
    setCurrentTripDetails(null);
    setIsDemoPlan(false);
    setPlanMessage(null);
    clearAppSessionStorage();

    const controller = new AbortController();
    generateAbortRef.current = controller;

    try {
      const response = await generateTravelPlan(formData, { signal: controller.signal });
      if (controller.signal.aborted || generateAbortRef.current !== controller) {
        return;
      }
      setCurrentPlan(response.plan);
      setCurrentPlanId(response.id || null);
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
      if (err?.name === 'AbortError') return;
      setErrorMessage(err.message || 'An error occurred while generating your travel plan. Please check your network and try again.');
    } finally {
      if (generateAbortRef.current === controller) {
        setIsLoading(false);
      }
    }
  };

  const handleModifyPlan = async (modificationRequest: string) => {
    if (isModifying || !currentTripDetails || !currentPlan) return;

    setIsModifying(true);
    setModifyError(null);

    try {
      const response = await modifyTravelPlan(
        currentTripDetails,
        currentPlan,
        modificationRequest,
        currentPlanId || undefined
      );

      // Save updated plan in session storage so it persists across manual page refreshes
      saveAppSessionStorage(response.plan, currentTripDetails, response.isDemo, response.message);

      // Instantaneous in-place state update without an expensive browser page reload
      setCurrentPlan(response.plan);
      if (response.id) {
        setCurrentPlanId(response.id);
      }
      setIsDemoPlan(response.isDemo);
      setPlanMessage(response.message || null);
      setShowModifiedSuccess(true);
      setIsModifying(false);

      if (user) {
        loadHistory();
      }

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
    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
    }
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setLoadingDetailId(id);
    setDetailError(null);
    try {
      const detail = await fetchTravelPlanById(id, { signal: controller.signal });
      if (controller.signal.aborted || detailAbortRef.current !== controller) {
        return;
      }
      setOpenedSavedItinerary(detail);
      setCurrentPlanId(detail.id);
      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setDetailError(err.message || 'Unable to load itinerary.');
    } finally {
      if (detailAbortRef.current === controller) {
        setLoadingDetailId(null);
      }
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
        additionalNotes: openedSavedItinerary.additionalNotes || '',
        includeDayByDayItinerary: openedSavedItinerary.includeDayByDayItinerary ?? (openedSavedItinerary.plan?.includeDayByDayItinerary ?? (Array.isArray(openedSavedItinerary.plan?.itinerary) && openedSavedItinerary.plan.itinerary.length > 0))
      };

      const response = await modifyTravelPlan(
        tripFormData,
        openedSavedItinerary.plan,
        modificationRequest,
        openedSavedItinerary.id
      );

      setOpenedSavedItinerary({
        ...openedSavedItinerary,
        plan: response.plan,
        updatedAt: response.updatedAt || new Date().toISOString()
      });
      setShowModifiedSuccess(true);
      setIsModifying(false);

      if (user) {
        loadHistory();
      }

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

  const handleDeleteItinerary = async (id: string) => {
    try {
      await deleteTravelPlan(id);
      if (openedSavedItinerary?.id === id) {
        setOpenedSavedItinerary(null);
      }
      if (currentPlanId === id) {
        setCurrentPlanId(null);
        setCurrentPlan(null);
        setCurrentTripDetails(null);
        clearAppSessionStorage();
      }
      await loadHistory();
    } catch (err: any) {
      setHistoryError(err.message || 'Unable to delete itinerary.');
    }
  };

  const handleLogout = () => {
    if (historyAbortRef.current) historyAbortRef.current.abort();
    if (detailAbortRef.current) detailAbortRef.current.abort();
    if (generateAbortRef.current) generateAbortRef.current.abort();
    setUser(null);
    setCurrentPlan(null);
    setCurrentPlanId(null);
    setCurrentTripDetails(null);
    setOpenedSavedItinerary(null);
    setDetailError(null);
    setSavedItineraries([]);
    setErrorMessage(null);
    setModifyError(null);
    setShowModifiedSuccess(false);
    clearAppSessionStorage();
  };

  const handleStartNewPlan = () => {
    clearAppSessionStorage();
    setCurrentPlan(null);
    setCurrentPlanId(null);
    setCurrentTripDetails(null);
    setOpenedSavedItinerary(null);
    setDetailError(null);
    setIsDemoPlan(false);
    setPlanMessage(null);
    setErrorMessage(null);
    setModifyError(null);
    setShowModifiedSuccess(false);
    const norm = currentRoute.replace(/\/+$/, '') || '/';
    if (norm !== '/') {
      navigate('/');
    } else {
      scrollToForm();
    }
  };

  const normalizedRoute = currentRoute.replace(/\/+$/, '') || '/';

  // Render Authentication Page (/signin, /signup)
  if (normalizedRoute === '/signin' || normalizedRoute === '/signup') {
    if (user) {
      navigate('/');
      return null;
    }
    return (
      <div className="app-layout" id="top">
        <a href="#main-content" className="skip-to-content-link">
          Skip to main content
        </a>
        <Header
          onNewPlan={() => navigate('/')}
          hasPlan={false}
          user={null}
          onOpenAuth={() => navigate('/signin')}
        />
        <AuthPage
          initialMode={normalizedRoute === '/signup' ? 'signup' : 'login'}
          onAuthSuccess={(authUser) => {
            setUser(authUser);
            navigate('/');
          }}
          onNavigateHome={() => navigate('/')}
          onSwitchMode={(mode) => {
            const target = mode === 'signup' ? '/signup' : '/signin';
            window.history.pushState({}, '', target);
            setCurrentRoute(target);
          }}
        />
        <footer className="enterprise-footer">
          <div className="container footer-inner">
            <div>
              <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '1rem', marginBottom: '0.25rem' }}>
                TravelGenie &bull; Enterprise Destination Planner
              </div>
              <p className="footer-disclaimer">
                Tailored destination intelligence, accommodations, culinary heritage, activities, and day-by-day schedules. Powered by Google Gemini AI. All recommendations and budget calculations are advisory estimates.
              </p>
            </div>
            <div>
              <div className="footer-links-group">
                <a href="/" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Home Planner</a>
                <span className="footer-link-divider">&bull;</span>
                <a href="/privacy" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>Privacy Policy</a>
                <span className="footer-link-divider">&bull;</span>
                <a href="/terms" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>User Agreement</a>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                &copy; {new Date().getFullYear()} TravelGenie. All rights reserved.
              </div>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // Render Public Privacy Policy Page (/privacy)
  if (normalizedRoute === '/privacy') {
    return (
      <div className="app-layout" id="top">
        <a href="#main-content" className="skip-to-content-link">
          Skip to main content
        </a>
        <Header
          onNewPlan={handleStartNewPlan}
          hasPlan={false}
          user={user}
          onUpdateUser={setUser}
          onLogout={handleLogout}
          onOpenAuth={() => navigate('/signin')}
        />
        <PrivacyPolicy
          onNavigateHome={() => navigate('/')}
          onNavigateTerms={() => navigate('/terms')}
        />
        <footer className="enterprise-footer">
          <div className="container footer-inner">
            <div>
              <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '1rem', marginBottom: '0.25rem' }}>
                TravelGenie &bull; Enterprise Destination Planner
              </div>
              <p className="footer-disclaimer">
                Tailored destination intelligence, accommodations, culinary heritage, activities, and day-by-day schedules. Powered by Google Gemini AI. All recommendations and budget calculations are advisory estimates.
              </p>
            </div>
            <div>
              <div className="footer-links-group">
                <a href="/" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Home Planner</a>
                <span className="footer-link-divider">&bull;</span>
                <span className="footer-link-active">Privacy Policy</span>
                <span className="footer-link-divider">&bull;</span>
                <a href="/terms" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>User Agreement</a>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                &copy; {new Date().getFullYear()} TravelGenie. All rights reserved.
              </div>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // Render Public User Agreement / Terms of Service Page (/terms)
  if (normalizedRoute === '/terms') {
    return (
      <div className="app-layout" id="top">
        <a href="#main-content" className="skip-to-content-link">
          Skip to main content
        </a>
        <Header
          onNewPlan={handleStartNewPlan}
          hasPlan={false}
          user={user}
          onUpdateUser={setUser}
          onLogout={handleLogout}
          onOpenAuth={() => navigate('/signin')}
        />
        <TermsOfService
          onNavigateHome={() => navigate('/')}
          onNavigatePrivacy={() => navigate('/privacy')}
        />
        <footer className="enterprise-footer">
          <div className="container footer-inner">
            <div>
              <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '1rem', marginBottom: '0.25rem' }}>
                TravelGenie &bull; Enterprise Destination Planner
              </div>
              <p className="footer-disclaimer">
                Tailored destination intelligence, accommodations, culinary heritage, activities, and day-by-day schedules. Powered by Google Gemini AI. All recommendations and budget calculations are advisory estimates.
              </p>
            </div>
            <div>
              <div className="footer-links-group">
                <a href="/" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Home Planner</a>
                <span className="footer-link-divider">&bull;</span>
                <a href="/privacy" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>Privacy Policy</a>
                <span className="footer-link-divider">&bull;</span>
                <span className="footer-link-active">User Agreement</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                &copy; {new Date().getFullYear()} TravelGenie. All rights reserved.
              </div>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // Main Planner View
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
        onLogout={handleLogout}
        onOpenAuth={() => navigate('/signin')}
      />

      <main id="main-content" tabIndex={-1}>
        {!currentPlan && !openedSavedItinerary && (
          <HeroLanding onPlanClick={user ? scrollToForm : () => navigate('/signin')} />
        )}

        {!user ? (
          /* UNAUTHENTICATED USER: Show ONLY centered authentication Call-To-Action */
          <section className="auth-cta-section" id="auth-cta-section" aria-label="Member Sign In">
            <div className="container">
              <div className="auth-cta-card">
                <div className="auth-cta-badge">Member Access Required</div>
                <h2 className="auth-cta-heading">Ready to Plan Your Next Journey?</h2>
                <p className="auth-cta-subtext">
                  Sign up or log in to create custom day-by-day itineraries, estimate budgets in INR, and save your trip history.
                </p>
                <div>
                  <button
                    type="button"
                    className="auth-cta-btn"
                    onClick={() => navigate('/signin')}
                    id="auth-cta-button"
                  >
                    Sign Up / Log In
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* AUTHENTICATED USER: Show existing itinerary form, history, and results */
          <>
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

            {!openedSavedItinerary && (
              <div id="previous-itineraries-section">
                <PreviousItineraries
                  itineraries={savedItineraries}
                  isLoading={isLoadingHistory}
                  error={historyError}
                  onSelectItinerary={handleSelectPreviousItinerary}
                  loadingId={loadingDetailId}
                  onDeleteItinerary={handleDeleteItinerary}
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
          </>
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
          <div>
            <div className="footer-links-group">
              <a href="/privacy" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>Privacy Policy</a>
              <span className="footer-link-divider">&bull;</span>
              <a href="/terms" className="footer-link" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>User Agreement</a>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              &copy; {new Date().getFullYear()} TravelGenie. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
