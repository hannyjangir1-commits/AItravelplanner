import React, { useState, useMemo } from 'react';
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

interface TravelFormProps {
  onSubmit: (data: TripFormData) => void;
  isLoading: boolean;
  errorMessage?: string | null;
}

export const TravelForm: React.FC<TravelFormProps> = ({ onSubmit, isLoading, errorMessage }) => {
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
    }

    if (formData.numberOfDays === '' || Number(formData.numberOfDays) <= 0) {
      errs.numberOfDays = 'Enter at least 1 day';
    } else if (Number(formData.numberOfDays) > 30) {
      errs.numberOfDays = 'Maximum supported duration is 30 days';
    }

    if (formData.budgetInr === '' || Number(formData.budgetInr) <= 0) {
      errs.budgetInr = 'Please enter a valid budget in INR (₹)';
    }

    if (formData.numberOfTravellers === '' || Number(formData.numberOfTravellers) <= 0) {
      errs.numberOfTravellers = 'Minimum 1 traveller required';
    }

    return errs;
  }, [formData]);

  const isValid = Object.keys(errors).length === 0;

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const toggleInterest = (interest: string) => {
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
            <div className="alert-box alert-danger" role="alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <div>{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-grid-layout">
              {/* Destination */}
              <div className="form-field-group col-12">
                <label className="field-label" htmlFor="destination">
                  Destination <span className="required-star">*</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    required
                  />
                </div>
                {touched.destination && errors.destination && (
                  <span className="field-validation-msg">{errors.destination}</span>
                )}
              </div>

              {/* Number of days */}
              <div className="form-field-group col-4">
                <label className="field-label" htmlFor="numberOfDays">
                  Number of Days <span className="required-star">*</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    required
                  />
                </div>
                {touched.numberOfDays && errors.numberOfDays && (
                  <span className="field-validation-msg">{errors.numberOfDays}</span>
                )}
              </div>

              {/* Total budget in INR */}
              <div className="form-field-group col-4">
                <label className="field-label" htmlFor="budgetInr">
                  Total Budget in INR (₹) <span className="required-star">*</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon" style={{ fontWeight: 700, fontSize: '1rem' }}>₹</span>
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
                    required
                  />
                </div>
                {touched.budgetInr && errors.budgetInr && (
                  <span className="field-validation-msg">{errors.budgetInr}</span>
                )}
              </div>

              {/* Number of travellers */}
              <div className="form-field-group col-4">
                <label className="field-label" htmlFor="numberOfTravellers">
                  Number of Travellers <span className="required-star">*</span>
                </label>
                <div className="field-input-box">
                  <span className="field-prefix-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    required
                  />
                </div>
                {touched.numberOfTravellers && errors.numberOfTravellers && (
                  <span className="field-validation-msg">{errors.numberOfTravellers}</span>
                )}
              </div>

              {/* Interests Multi-select Chips */}
              <div className="form-field-group col-12">
                <label className="field-label">
                  <span>Travel Interests</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.8rem' }}>
                    (Select all relevant focus areas)
                  </span>
                </label>
                <div className="chips-flex-wrap">
                  {AVAILABLE_INTERESTS.map((interest) => {
                    const isSelected = formData.interests.includes(interest);
                    return (
                      <button
                        type="button"
                        key={interest}
                        className={`interest-chip-item ${isSelected ? 'active' : ''}`}
                        onClick={() => toggleInterest(interest)}
                      >
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
                <label className="field-label">Accommodation Preference</label>
                <div className="segmented-radios">
                  {ACCOMMODATION_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      className={`segmented-radio-btn ${formData.accommodationPreference === opt.id ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, accommodationPreference: opt.id })}
                    >
                      <div className="segmented-title">{opt.label}</div>
                      <div className="segmented-sub">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Activity Level */}
              <div className="form-field-group col-6">
                <label className="field-label">Activity Level</label>
                <div className="segmented-radios">
                  {ACTIVITY_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      className={`segmented-radio-btn ${formData.activityLevel === opt.id ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, activityLevel: opt.id })}
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
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="form-submit-footer">
              <button
                type="submit"
                id="generate-plan-btn"
                className="btn-generate-plan"
                disabled={!isValid || isLoading}
              >
                {isLoading ? (
                  <>
                    <span className="spinner-ring"></span>
                    <span>Generating Travel Plan...</span>
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
