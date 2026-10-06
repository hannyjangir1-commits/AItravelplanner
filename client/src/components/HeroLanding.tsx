import React from 'react';

interface HeroLandingProps {
  onPlanClick: () => void;
}

export const HeroLanding: React.FC<HeroLandingProps> = ({ onPlanClick }) => {
  return (
    <section className="hero-wrapper" id="landing" aria-label="Welcome and Trip Planning Overview">
      <div className="container">
        <div className="hero-content">
          <div className="hero-meta-pill">
            <span>Destination Experience Advisory</span>
          </div>

          <h1 className="hero-headline">TravelGenie</h1>
          
          <p className="hero-subtext">
            Create a personalized travel plan for your destination.
          </p>

          <div>
            <button
              className="hero-cta-btn"
              onClick={onPlanClick}
              id="plan-my-trip-btn"
              aria-label="Plan My Trip - jump to destination planning form"
            >
              <span>Plan My Trip</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </button>
          </div>

          <div className="hero-trust-bar" role="list" aria-label="Key system features">
            <div className="trust-item" role="listitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>Destination-Focused</span>
            </div>
            <div className="trust-item" role="listitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>INR Realistic Budgeting</span>
            </div>
            <div className="trust-item" role="listitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Curated Local Dining & Culture</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
