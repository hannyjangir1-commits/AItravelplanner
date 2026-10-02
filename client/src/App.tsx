import { useState, useRef } from 'react';
import type { TravelPlan, TripFormData } from './types';
import { generateTravelPlan, modifyTravelPlan } from './api';
import { Header } from './components/Header';
import { HeroLanding } from './components/HeroLanding';
import { TravelForm } from './components/TravelForm';
import { PlanResult } from './components/PlanResult';

export function App() {
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(null);
  const [currentTripDetails, setCurrentTripDetails] = useState<TripFormData | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modifyError, setModifyError] = useState<string | null>(null);

  const formSectionRef = useRef<HTMLDivElement>(null);
  const resultsSectionRef = useRef<HTMLDivElement>(null);

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

      // Smooth scroll to results
      setTimeout(() => {
        const el = document.getElementById('plan-results');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
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
      setCurrentPlan(response.plan);
    } catch (err: any) {
      setModifyError(err.message || 'Failed to update travel plan. Please try again.');
    } finally {
      setIsModifying(false);
    }
  };

  const handleStartNewPlan = () => {
    setCurrentPlan(null);
    setCurrentTripDetails(null);
    setErrorMessage(null);
    setModifyError(null);
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
