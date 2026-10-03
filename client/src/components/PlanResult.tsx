import React, { useState } from 'react';
import type { TravelPlan, TripFormData, DayPlan } from '../types';

/* -------------------------------------------------------------------------- */
/* Day-Wise Itinerary Subcomponent                                            */
/* -------------------------------------------------------------------------- */
interface DayWiseItineraryProps {
  itinerary: DayPlan[];
}

export const DayWiseItinerary: React.FC<DayWiseItineraryProps> = ({ itinerary }) => {
  if (!itinerary || itinerary.length === 0) {
    return null;
  }

  return (
    <div className="itinerary-outer">
      <div className="itinerary-heading-bar">
        <h3 className="itinerary-main-title">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: 'var(--color-primary)' }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>Day-by-Day Itinerary Schedule</span>
        </h3>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {itinerary.length} Days Destination Program
        </span>
      </div>

      <div className="days-stack">
        {itinerary.map((day) => (
          <div key={day.day} className="day-timeline-card">
            <div className="day-top-bar">
              <span className="day-number-pill">Day {day.day}</span>
              <span style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Destination Schedule & Sightseeing
              </span>
            </div>

            <div className="day-timeblocks-grid">
              {/* Morning */}
              <div className="timeblock-box">
                <div className="timeblock-tag tag-morning">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  </svg>
                  <span>Morning</span>
                </div>
                <div className="timeblock-text">{day.morning}</div>
              </div>

              {/* Afternoon */}
              <div className="timeblock-box">
                <div className="timeblock-tag tag-afternoon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                  </svg>
                  <span>Afternoon</span>
                </div>
                <div className="timeblock-text">{day.afternoon}</div>
              </div>

              {/* Evening */}
              <div className="timeblock-box">
                <div className="timeblock-tag tag-evening">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                  <span>Evening</span>
                </div>
                <div className="timeblock-text">{day.evening}</div>
              </div>
            </div>

            {/* Notes & Alternative Activity */}
            <div className="day-logistics-grid">
              {day.notes && (
                <div className="logistics-box box-notes">
                  <strong>Practical Note: </strong>
                  <span>{day.notes}</span>
                </div>
              )}

              {day.alternative && (
                <div className="logistics-box box-alternative">
                  <strong>Alternative Activity: </strong>
                  <span>{day.alternative}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Plan Modifier Subcomponent                                                 */
/* -------------------------------------------------------------------------- */
const SUGGESTED_MODIFICATIONS = [
  'Make it more budget friendly',
  'Add more food places',
  'Make Day 2 more relaxed',
  'Give indoor alternatives',
  'Add more photography locations'
];

interface PlanModifierProps {
  onModify: (requestText: string) => void;
  isModifying: boolean;
  modifyError?: string | null;
}

export const PlanModifier: React.FC<PlanModifierProps> = ({ onModify, isModifying, modifyError }) => {
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isModifying) return;
    onModify(inputText.trim());
    setInputText('');
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isModifying) return;
    onModify(suggestion);
  };

  return (
    <div className="modifier-console-card" id="modify-plan-section">
      <div className="modifier-title-area">
        <h3 className="modifier-heading">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: 'var(--color-primary)' }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>Modify Plan</span>
        </h3>
        <p className="modifier-sub">
          Request refinements to pacing, budget, food options, or specific venues. Your original details are preserved.
        </p>
      </div>

      {modifyError && (
        <div className="alert-box alert-danger" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>{modifyError}</div>
        </div>
      )}

      {/* Suggested Quick Modifications */}
      <div className="quick-prompts-bar">
        {SUGGESTED_MODIFICATIONS.map((suggestion, idx) => (
          <button
            key={idx}
            type="button"
            className="prompt-pill-btn"
            disabled={isModifying}
            onClick={() => handleSuggestionClick(suggestion)}
          >
            + {suggestion}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="modifier-input-form">
        <input
          type="text"
          className="modifier-text-input"
          placeholder="e.g. Include vegetarian food stalls, prioritize morning sights, reduce budget..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isModifying}
        />
        <button
          type="submit"
          className="btn-modify-submit"
          disabled={!inputText.trim() || isModifying}
        >
          {isModifying ? (
            <>
              <span className="spinner-ring"></span>
              <span>Modifying Plan...</span>
            </>
          ) : (
            <>
              <span>Modify Plan</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Main Plan Result Component                                                 */
/* -------------------------------------------------------------------------- */
interface PlanResultProps {
  plan: TravelPlan;
  tripDetails: TripFormData;
  onModify: (requestText: string) => void;
  isModifying: boolean;
  modifyError?: string | null;
  onPlanAnother: () => void;
  showModifiedSuccess?: boolean;
  onDismissSuccess?: () => void;
}

export const PlanResult: React.FC<PlanResultProps> = ({
  plan,
  tripDetails,
  onModify,
  isModifying,
  modifyError,
  onPlanAnother,
  showModifiedSuccess,
  onDismissSuccess
}) => {
  const totalDays = Number(tripDetails.numberOfDays) || 1;
  const travellers = Number(tripDetails.numberOfTravellers) || 1;
  const budget = Number(tripDetails.budgetInr) || 0;
  const perPersonPerDay = Math.round(budget / (totalDays * travellers));

  return (
    <section className="results-dashboard" id="plan-results">
      <div className="container">
        {/* Modification Success Banner */}
        {showModifiedSuccess && (
          <div className="alert-box alert-success" role="status">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: '#059669', flexShrink: 0 }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span>
                <strong>Plan modified successfully!</strong> Showing your updated itinerary from the start.
              </span>
            </div>
            {onDismissSuccess && (
              <button
                type="button"
                className="btn-alert-close"
                onClick={onDismissSuccess}
                title="Dismiss banner"
                aria-label="Dismiss"
              >
                &times;
              </button>
            )}
          </div>
        )}

        {/* Executive Summary Header */}
        <div className="executive-summary-header">
          <div>
            <div className="summary-destination-tag">Destination Travel Briefing</div>
            <h2 className="summary-destination-name">{tripDetails.destination}</h2>
            <div className="summary-stats-pills">
              <span className="summary-stat-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {totalDays} Days
              </span>
              <span className="summary-stat-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                </svg>
                {travellers} Traveller{travellers > 1 ? 's' : ''}
              </span>
              <span className="summary-stat-badge">
                ₹{budget.toLocaleString('en-IN')} Total Budget
              </span>
              <span className="summary-stat-badge">
                ~₹{perPersonPerDay.toLocaleString('en-IN')}/person/day
              </span>
              <span className="summary-stat-badge">
                {tripDetails.accommodationPreference} Stay
              </span>
              <span className="summary-stat-badge">
                {tripDetails.activityLevel} Pace
              </span>
            </div>
          </div>

          <div className="action-buttons-group">
            <button className="btn-action-outline" onClick={() => window.print()} title="Print or save as PDF">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              <span>Export PDF / Print</span>
            </button>
            <button className="btn-action-outline" onClick={onPlanAnother}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              <span>Edit Details</span>
            </button>
          </div>
        </div>

        {/* 6 Structured Cards Grid */}
        <div className="cards-multi-grid">
          {/* Accommodation Guidance */}
          <div className="executive-card card-span-4">
            <div className="card-header-bar">
              <div className="card-icon-frame icon-blue-theme">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </div>
              <h3 className="card-title-text">Accommodation Guidance</h3>
            </div>
            <p className="card-body-text">{plan.accommodationGuidance}</p>
          </div>

          {/* Weather Advice */}
          <div className="executive-card card-span-4">
            <div className="card-header-bar">
              <div className="card-icon-frame icon-gold-theme">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
              </div>
              <h3 className="card-title-text">Weather Advice</h3>
            </div>
            <p className="card-body-text">{plan.weatherAdvice}</p>
          </div>

          {/* Budget Tips */}
          <div className="executive-card card-span-4">
            <div className="card-header-bar">
              <div className="card-icon-frame icon-emerald-theme">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <line x1="12" y1="1" x2="12" y2="23"></line>
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
              </div>
              <h3 className="card-title-text">Budget Tips</h3>
            </div>
            <div className="budget-tips-stack">
              {plan.budgetTips.map((tip, idx) => (
                <div key={idx} className="budget-tip-row">
                  {tip}
                </div>
              ))}
            </div>
          </div>

          {/* Places to Visit */}
          <div className="executive-card card-span-12">
            <div className="card-header-bar">
              <div className="card-icon-frame icon-blue-theme">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
              </div>
              <h3 className="card-title-text">Places to Visit</h3>
            </div>
            <div className="structured-items-list">
              {plan.placesToVisit.map((place, idx) => (
                <div key={idx} className="structured-item-entry">
                  <div className="entry-head">
                    <span className="entry-name">{place.name}</span>
                    {place.bestTime && (
                      <span className="entry-badge-gold">
                        Best Time: {place.bestTime}
                      </span>
                    )}
                  </div>
                  <p className="entry-desc">{place.reason}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Food and Local Experiences */}
          <div className="executive-card card-span-6">
            <div className="card-header-bar">
              <div className="card-icon-frame icon-gold-theme">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
                  <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                  <line x1="6" y1="1" x2="6" y2="4"></line>
                  <line x1="10" y1="1" x2="10" y2="4"></line>
                  <line x1="14" y1="1" x2="14" y2="4"></line>
                </svg>
              </div>
              <h3 className="card-title-text">Food & Local Experiences</h3>
            </div>
            <div className="structured-items-list">
              {plan.foodAndLocalExperiences.map((food, idx) => (
                <div key={idx} className="structured-item-entry">
                  <div className="entry-head">
                    <span className="entry-name">{food.name}</span>
                  </div>
                  <p className="entry-desc">{food.reason}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Activities */}
          <div className="executive-card card-span-6">
            <div className="card-header-bar">
              <div className="card-icon-frame icon-emerald-theme">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="m4.93 4.93 4.24 4.24"></path>
                  <path d="m14.83 9.17 4.24-4.24"></path>
                  <path d="m14.83 14.83 4.24 4.24"></path>
                  <path d="m9.17 14.83-4.24 4.24"></path>
                  <circle cx="12" cy="12" r="4"></circle>
                </svg>
              </div>
              <h3 className="card-title-text">Curated Activities</h3>
            </div>
            <div className="structured-items-list">
              {plan.activities.map((act, idx) => (
                <div key={idx} className="structured-item-entry">
                  <div className="entry-head">
                    <span className="entry-name">{act.name}</span>
                  </div>
                  <p className="entry-desc">{act.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Day-Wise Itinerary */}
        <DayWiseItinerary itinerary={plan.itinerary} />

        {/* Modify Plan Chat Input */}
        <PlanModifier
          onModify={onModify}
          isModifying={isModifying}
          modifyError={modifyError}
        />
      </div>
    </section>
  );
};
