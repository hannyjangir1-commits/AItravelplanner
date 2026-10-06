import { useState, useEffect } from 'react';
import type { TravelPlan, TripFormData } from './types';
import { generateTravelPlan, modifyTravelPlan } from './api';
import { Header } from './components/Header';
import { HeroLanding } from './components/HeroLanding';
import { TravelForm } from './components/TravelForm';
import { PlanResult } from './components/PlanResult';

import {
  loadStoredSession,
  saveAppSessionStorage,
  clearAppSessionStorage,
  checkAndClearJustModifiedFlag,
  type StoredSessionState
} from './storage';

export function App() {
  const [initialSession] = useState<StoredSessionState>(() => loadStoredSession());
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(initialSession.plan);
  const [currentTripDetails, setCurrentTripDetails] = useState<TripFormData | null>(initialSession.details);
  const [isDemoPlan, setIsDemoPlan] = useState<boolean>(initialSession.isDemo);
  const [planMessage, setPlanMessage] = useState<string | null>(initialSession.message);

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

  const handleStartNewPlan = () => {
    clearAppSessionStorage();
    setCurrentPlan(null);
    setCurrentTripDetails(null);
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
      <Header onNewPlan={handleStartNewPlan} hasPlan={Boolean(currentPlan)} />

      <main id="main-content" tabIndex={-1}>
        {!currentPlan && <HeroLanding onPlanClick={scrollToForm} />}

        <div>
          <TravelForm
            onSubmit={handleGeneratePlan}
            isLoading={isLoading}
            errorMessage={errorMessage}
            onDismissError={() => setErrorMessage(null)}
          />
        </div>

        {currentPlan && currentTripDetails && (
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
