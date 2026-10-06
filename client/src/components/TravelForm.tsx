import React, { useState, useMemo, useEffect } from 'react';
import type { TripFormData, AccommodationType, ActivityLevelType } from '../types';

const AVAILABLE_INTERESTS = [
  'Beaches',
  'Food',
  'Photography',
  'Adventure',
  'Nature',
  'Culture',
  'Shopping',
  'Nightlife',
  'Relaxation'
];

const ACCOMMODATION_OPTIONS: { id: AccommodationType; label: string; sub: string }[] = [
  { id: 'Budget', label: 'Budget', sub: 'Hostels & Value Inns' },
  { id: 'Moderate', label: 'Moderate', sub: '3-4★ Boutique Hotels' },
  { id: 'Premium', label: 'Premium', sub: '5★ Luxury & Resorts' }
];

const ACTIVITY_OPTIONS: { id: ActivityLevelType; label: string; sub: string }[] = [
  { id: 'Relaxed', label: 'Relaxed', sub: 'Leisurely pacing' },
  { id: 'Moderate', label: 'Moderate', sub: 'Balanced discovery' },
  { id: 'Active', label: 'Active', sub: 'Full day exploring' }
];

const LOADING_STAGES = [
  {
    label: 'Preparing travel preferences',
    desc: 'Analyzing destination parameters, duration, budget tier, and travel style'
  },
  {
    label: 'Generating personalized recommendations',
    desc: 'Curating accommodations, cultural dining, and places to visit'
  },
  {
    label: 'Building day-wise itinerary',
    desc: 'Structuring balanced morning, afternoon, and evening timeblocks'
  },
  {
    label: 'Finalizing travel plan',
    desc: 'Consolidating logistics, weather advice, and budget allocation tips'
  }
];

const GenerationLoadingProgress: React.FC<{ destination: string }> = React.memo(({ destination }) => {
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isExtendedWait, setIsExtendedWait] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    const timers: NodeJS.Timeout[] = [
      setTimeout(() => setCurrentStageIndex(1), 2500),
      setTimeout(() => setCurrentStageIndex(2), 5500),
      setTimeout(() => setCurrentStageIndex(3), 9000),
      setTimeout(() => setIsExtendedWait(true), 13000)
    ];

    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="generation-loading-container" role="status" aria-live="polite" aria-label={`Planning trip to ${destination.trim() || 'destination'}`}>
      <div className="generation-loading-header">
        <span className="generation-spinner" aria-hidden="true"></span>
        <div className="generation-header-text">
          <h4 className="generation-loading-title">
            Planning your trip to {destination.trim() || 'your destination'}
          </h4>
          <p className="generation-loading-sub">
            Personalized destination intelligence in progress &bull; Please keep this window open
          </p>
        </div>
        <div className="generation-elapsed-badge" aria-label={`${elapsedSeconds} seconds elapsed`}>
          <span className="elapsed-pulse-dot" aria-hidden="true"></span>
          <span>{elapsedSeconds}s elapsed</span>
        </div>
      </div>

      <ol className="stages-timeline" aria-label="Trip planning progress stages">
        {LOADING_STAGES.map((stage, idx) => {
          const isCurrent = idx === currentStageIndex;
          const isCompleted = idx < currentStageIndex;
          return (
            <li
              key={idx}
              className={`stage-timeline-item ${isCurrent ? 'active' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="stage-indicator" aria-hidden="true">
                {isCurrent ? (
                  <span className="stage-active-pulse"></span>
                ) : (
                  <span className="stage-pending-dot"></span>
                )}
              </div>
              <div className="stage-content">
                <div className="stage-label">
                  {isCurrent && <span className="sr-only">Current Step: </span>}
                  {isCompleted && <span className="sr-only">Completed: </span>}
                  {stage.label}
                </div>
                <div className="stage-desc">{stage.desc}</div>
              </div>
            </li>
          );
        })}
      </ol>

      {isExtendedWait && (
        <div className="extended-wait-notice" role="alert" aria-live="polite">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>
            Generation is still running. Synthesizing detailed schedules and budget breakdown for your destination...
          </span>
        </div>
      )}

      <div className="generation-loading-footnote" role="note">
        <span>AI destination planning typically takes 5–15 seconds for comprehensive itineraries.</span>
        <span className="generation-running-badge">Live Generation Active</span>
      </div>
    </div>
  );
});

interface TravelFormProps {
  onSubmit: (data: TripFormData) => void;
  isLoading: boolean;
  errorMessage?: string | null;
  onDismissError?: () => void;
}

export const TravelForm: React.FC<TravelFormProps> = ({ onSubmit, isLoading, errorMessage, onDismissError }) => {
  const [formData, setFormData] = useState<TripFormData>({
    destination: '',
    numberOfDays: 3,
    budgetInr: 25000,
    numberOfTravellers: 2,
    interests: ['Food', 'Culture'],
    accommodationPreference: 'Moderate',
    activityLevel: 'Moderate',
    additionalNotes: ''
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Validation rules
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};

    if (!formData.destination.trim()) {
      errs.destination = 'Destination is required (e.g. Kyoto, Jaipur, Barcelona)';
    } else if (formData.destination.trim().length > 150) {
      errs.destination = 'Destination must not exceed 150 characters';
    }

    if (formData.numberOfDays === '' || Number(formData.numberOfDays) <= 0) {
      errs.numberOfDays = 'Enter at least 1 day';
    } else if (Number(formData.numberOfDays) > 30) {
      errs.numberOfDays = 'Maximum supported duration is 30 days';
    }

    if (formData.budgetInr === '' || Number(formData.budgetInr) <= 0) {
      errs.budgetInr = 'Please enter a valid budget in INR (₹)';
    } else if (Number(formData.budgetInr) > 100_000_000) {
      errs.budgetInr = 'Budget cannot exceed ₹10,00,00,000';
    }

    if (formData.numberOfTravellers === '' || Number(formData.numberOfTravellers) <= 0) {
      errs.numberOfTravellers = 'Minimum 1 traveller required';
    } else if (Number(formData.numberOfTravellers) > 20) {
      errs.numberOfTravellers = 'Maximum 20 travellers allowed';
    }

    if (formData.additionalNotes && formData.additionalNotes.length > 1000) {
      errs.additionalNotes = 'Additional notes must not exceed 1000 characters';
    }

    return errs;
  }, [formData]);

  const isValid = Object.keys(errors).length === 0;

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const toggleInterest = (interest: string) => {
    if (isLoading) return;
    setFormData((prev) => {
      const exists = prev.interests.includes(interest);
      const updated = exists
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest];
      return { ...prev, interests: updated };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isLoading) return;
    onSubmit(formData);
  };

  return (
    <section className="form-section-container" id="travel-form-section">
      <div className="container">
        <div className="enterprise-form-card">
          <div className="form-section-title-bar">
            <h2 className="form-main-heading">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-primary)' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
              </svg>
              <span>Destination Itinerary Planning</span>
            </h2>
            <span className="form-help-subtitle">
              We focus on what you will do, visit, stay, and eat after reaching your destination.
            </span>
          </div>

          {errorMessage && (
            <div className="form-error-panel" role="alert" aria-live="assertive">
              <div className="error-panel-header">
                <div className="error-icon-box" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>
                <div className="error-content-body">
                  <h4 className="error-heading">Plan Generation Encountered an Issue</h4>
                  <p className="error-text">{errorMessage}</p>
                  <p className="error-help-hint">
                    Please verify your destination inputs, trip duration, and network connection, then try submitting again.
                  </p>
                </div>
                {onDismissError && (
                  <button
                    type="button"
                    className="error-dismiss-btn"
                    onClick={onDismissError}
                    aria-label="Dismiss error notification"
                    title="Dismiss error notification"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate aria-label="Destination travel parameters">
            <div className="form-grid-layout">
              {/* Destination */}
              <div className="form-field-group col-12">
                <label className="field-label" htmlFor="destination">
                  Destination <span className="required-star" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                  </span>
                  <input
                    id="destination"
                    type="text"
                    className="input-control"
                    placeholder="Enter city or region (e.g. Udaipur, Kyoto, Manali, Zurich)"
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    onBlur={() => handleBlur('destination')}
                    disabled={isLoading}
                    required
                    aria-required="true"
                    aria-invalid={touched.destination && !!errors.destination}
                    aria-describedby={touched.destination && errors.destination ? 'destination-error' : undefined}
                  />
                </div>
                {touched.destination && errors.destination && (
                  <span id="destination-error" className="field-validation-msg" role="alert">
                    {errors.destination}
                  </span>
                )}
              </div>

              {/* Number of days */}
              <div className="form-field-group col-4">
                <label className="field-label" htmlFor="numberOfDays">
                  Number of Days <span className="required-star" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                  </span>
                  <input
                    id="numberOfDays"
                    type="number"
                    min="1"
                    max="30"
                    className="input-control"
                    placeholder="e.g. 4"
                    value={formData.numberOfDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        numberOfDays: e.target.value === '' ? '' : Number(e.target.value)
                      })
                    }
                    onBlur={() => handleBlur('numberOfDays')}
                    disabled={isLoading}
                    required
                    aria-required="true"
                    aria-invalid={touched.numberOfDays && !!errors.numberOfDays}
                    aria-describedby={touched.numberOfDays && errors.numberOfDays ? 'numberOfDays-error' : undefined}
                  />
                </div>
                {touched.numberOfDays && errors.numberOfDays && (
                  <span id="numberOfDays-error" className="field-validation-msg" role="alert">
                    {errors.numberOfDays}
                  </span>
                )}
              </div>

              {/* Total budget in INR */}
              <div className="form-field-group col-4">
                <label className="field-label" htmlFor="budgetInr">
                  Total Budget in INR (₹) <span className="required-star" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon" style={{ fontWeight: 700, fontSize: '1rem' }} aria-hidden="true">₹</span>
                  <input
                    id="budgetInr"
                    type="number"
                    step="500"
                    min="1000"
                    className="input-control"
                    placeholder="e.g. 35000"
                    value={formData.budgetInr}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        budgetInr: e.target.value === '' ? '' : Number(e.target.value)
                      })
                    }
                    onBlur={() => handleBlur('budgetInr')}
                    disabled={isLoading}
                    required
                    aria-required="true"
                    aria-invalid={touched.budgetInr && !!errors.budgetInr}
                    aria-describedby={touched.budgetInr && errors.budgetInr ? 'budgetInr-error' : undefined}
                  />
                </div>
                {touched.budgetInr && errors.budgetInr && (
                  <span id="budgetInr-error" className="field-validation-msg" role="alert">
                    {errors.budgetInr}
                  </span>
                )}
              </div>

              {/* Number of travellers */}
              <div className="form-field-group col-4">
                <label className="field-label" htmlFor="numberOfTravellers">
                  Number of Travellers <span className="required-star" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                  </span>
                  <input
                    id="numberOfTravellers"
                    type="number"
                    min="1"
                    max="20"
                    className="input-control"
                    placeholder="e.g. 2"
                    value={formData.numberOfTravellers}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        numberOfTravellers: e.target.value === '' ? '' : Number(e.target.value)
                      })
                    }
                    onBlur={() => handleBlur('numberOfTravellers')}
                    disabled={isLoading}
                    required
                    aria-required="true"
                    aria-invalid={touched.numberOfTravellers && !!errors.numberOfTravellers}
                    aria-describedby={touched.numberOfTravellers && errors.numberOfTravellers ? 'numberOfTravellers-error' : undefined}
                  />
                </div>
                {touched.numberOfTravellers && errors.numberOfTravellers && (
                  <span id="numberOfTravellers-error" className="field-validation-msg" role="alert">
                    {errors.numberOfTravellers}
                  </span>
                )}
              </div>

              {/* Interests Multi-select Chips */}
              <div className="form-field-group col-12">
                <label className="field-label" id="interests-group-label">
                  <span>Travel Interests</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.8rem' }}>
                    (Select all relevant focus areas)
                  </span>
                </label>
                <div className="chips-flex-wrap" role="group" aria-labelledby="interests-group-label">
                  {AVAILABLE_INTERESTS.map((interest) => {
                    const isSelected = formData.interests.includes(interest);
                    return (
                      <button
                        type="button"
                        key={interest}
                        className={`interest-chip-item ${isSelected ? 'active' : ''}`}
                        onClick={() => toggleInterest(interest)}
                        disabled={isLoading}
                        aria-pressed={isSelected}
                        aria-label={`${interest}, ${isSelected ? 'selected' : 'not selected'}`}
                      >
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                        <span>{interest}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accommodation Preference */}
              <div className="form-field-group col-6">
                <label className="field-label" id="accommodation-group-label">Accommodation Preference</label>
                <div className="segmented-radios" role="radiogroup" aria-labelledby="accommodation-group-label">
                  {ACCOMMODATION_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      role="radio"
                      aria-checked={formData.accommodationPreference === opt.id}
                      aria-label={`${opt.label} accommodation: ${opt.sub}`}
                      className={`segmented-radio-btn ${formData.accommodationPreference === opt.id ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, accommodationPreference: opt.id })}
                      disabled={isLoading}
                    >
                      <div className="segmented-title">{opt.label}</div>
                      <div className="segmented-sub">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Activity Level */}
              <div className="form-field-group col-6">
                <label className="field-label" id="activity-group-label">Activity Level</label>
                <div className="segmented-radios" role="radiogroup" aria-labelledby="activity-group-label">
                  {ACTIVITY_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      role="radio"
                      aria-checked={formData.activityLevel === opt.id}
                      aria-label={`${opt.label} activity pace: ${opt.sub}`}
                      className={`segmented-radio-btn ${formData.activityLevel === opt.id ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, activityLevel: opt.id })}
                      disabled={isLoading}
                    >
                      <div className="segmented-title">{opt.label}</div>
                      <div className="segmented-sub">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional Additional Notes */}
              <div className="form-field-group col-12">
                <label className="field-label" htmlFor="additionalNotes">
                  <span>Optional Additional Notes</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.8rem' }}>
                    (Dietary preferences, accessibility, special occasions, neighborhood preferences)
                  </span>
                </label>
                <textarea
                  id="additionalNotes"
                  className="textarea-control"
                  rows={3}
                  placeholder="e.g. Vegetarian dining preferred, celebrating anniversary, avoid strenuous uphill climbs..."
                  value={formData.additionalNotes}
                  onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                  disabled={isLoading}
                  aria-label="Optional Additional Notes (e.g. dietary preferences, accessibility needs, preferred pace)"
                />
              </div>
            </div>

            {/* Professional Loading State */}
            {isLoading && <GenerationLoadingProgress destination={formData.destination} />}

            {/* Submit Button */}
            <div className="form-submit-footer">
              <button
                type="submit"
                id="generate-plan-btn"
                className="btn-generate-plan"
                disabled={!isValid || isLoading}
                aria-busy={isLoading}
                aria-label={isLoading ? 'Generating itinerary, please wait' : 'Generate Travel Plan'}
              >
                {isLoading ? (
                  <>
                    <span className="spinner-ring" aria-hidden="true"></span>
                    <span>Generating Itinerary...</span>
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Generate Travel Plan</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};
