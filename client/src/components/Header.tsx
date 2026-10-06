import React from 'react';

interface HeaderProps {
  onNewPlan?: () => void;
  hasPlan?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onNewPlan, hasPlan }) => {
  return (
    <header className="app-header">
      <div className="container header-inner">
        <a href="#top" className="header-brand" onClick={onNewPlan} aria-label="TravelGenie - Home and planning console">
          <div className="brand-badge-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
            </svg>
          </div>
          <div className="brand-text-block">
            <span className="brand-title">TravelGenie</span>
            <span className="brand-tagline">Destination Planning Intelligence</span>
          </div>
        </a>

        <div className="header-actions">
          {hasPlan && onNewPlan && (
            <button className="btn-nav-action" onClick={onNewPlan} title="Start new itinerary" aria-label="Start a new travel itinerary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>New Itinerary</span>
            </button>
          )}

        </div>
      </div>
    </header>
  );
};
