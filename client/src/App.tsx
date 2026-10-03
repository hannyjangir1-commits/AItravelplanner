import { useState, useRef, useEffect } from 'react';
import type { TravelPlan, TripFormData } from './types';
import { generateTravelPlan, modifyTravelPlan } from './api';
import { Header } from './components/Header';
import { HeroLanding } from './components/HeroLanding';
import { TravelForm } from './components/TravelForm';
import { PlanResult } from './components/PlanResult';

const STORAGE_KEY_PLAN = 'aitravel_plan';
const STORAGE_KEY_DETAILS = 'aitravel_details';
const STORAGE_KEY_JUST_MODIFIED = 'aitravel_just_modified';

export function App() {
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_PLAN);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [currentTripDetails, setCurrentTripDetails] = useState<TripFormData | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_DETAILS);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [showModifiedSuccess, setShowModifiedSuccess] = useState(false);

  const formSectionRef = useRef<HTMLDivElement>(null);
  const resultsSectionRef = useRef<HTMLDivElement>(null);

  // Check if page just reloaded after a modification
  useEffect(() => {
    const justModified = sessionStorage.getItem(STORAGE_KEY_JUST_MODIFIED);
    if (justModified === 'true') {
      sessionStorage.removeItem(STORAGE_KEY_JUST_MODIFIED);
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
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await generateTravelPlan(formData);
      setCurrentPlan(response.plan);
      setCurrentTripDetails(formData);

      // Save in session storage
      sessionStorage.setItem(STORAGE_KEY_PLAN, JSON.stringify(response.plan));
      sessionStorage.setItem(STORAGE_KEY_DETAILS, JSON.stringify(formData));

      // Smooth scroll to results
      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while generating your travel plan. Please check your network and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleModifyPlan = async (modificationRequest: string) => {
    if (!currentTripDetails || !currentPlan) return;

    setIsModifying(true);
    setModifyError(null);

    try {
      const response = await modifyTravelPlan(currentTripDetails, currentPlan, modificationRequest);

      // Save updated plan in session storage so it persists across page refresh
      sessionStorage.setItem(STORAGE_KEY_PLAN, JSON.stringify(response.plan));
      sessionStorage.setItem(STORAGE_KEY_DETAILS, JSON.stringify(currentTripDetails));
      sessionStorage.setItem(STORAGE_KEY_JUST_MODIFIED, 'true');

      // Refresh page and show from the start of the plan
      window.location.reload();
    } catch (err: any) {
      setModifyError(err.message || 'Failed to update travel plan. Please try again.');
      setIsModifying(false);
    }
  };

  const handleStartNewPlan = () => {
    sessionStorage.removeItem(STORAGE_KEY_PLAN);
    sessionStorage.removeItem(STORAGE_KEY_DETAILS);
    sessionStorage.removeItem(STORAGE_KEY_JUST_MODIFIED);
    setCurrentPlan(null);
    setCurrentTripDetails(null);
    setErrorMessage(null);
    setModifyError(null);
    setShowModifiedSuccess(false);
    scrollToForm();
  };

  return (
    <div className="app-layout" id="top">
      <Header onNewPlan={handleStartNewPlan} hasPlan={Boolean(currentPlan)} />

      <main>
        {!currentPlan && <HeroLanding onPlanClick={scrollToForm} />}

        <div ref={formSectionRef}>
          <TravelForm
            onSubmit={handleGeneratePlan}
            isLoading={isLoading}
            errorMessage={errorMessage}
          />
        </div>

        {currentPlan && currentTripDetails && (
          <div ref={resultsSectionRef}>
            <PlanResult
              plan={currentPlan}
              tripDetails={currentTripDetails}
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
              AI Travel Agent &bull; Enterprise Destination Planner
            </div>
            <p className="footer-disclaimer">
              Tailored destination intelligence, accommodations, culinary heritage, activities, and day-by-day schedules. Powered by Google Gemini AI. All recommendations and budget calculations are advisory estimates.
            </p>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            &copy; {new Date().getFullYear()} AI Travel Agent. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
