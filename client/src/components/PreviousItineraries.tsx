import React from 'react';
import type { ItinerarySummary } from '../types';

interface PreviousItinerariesProps {
  itineraries: ItinerarySummary[];
  isLoading: boolean;
  error: string | null;
  onSelectItinerary: (id: string) => void;
  loadingId: string | null;
}

/**
 * Formats ISO date string into readable local date/time (e.g. "Oct 7, 2026, 05:30 AM")
 * using standard browser Intl API.
 */
function formatHistoryDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export const PreviousItineraries: React.FC<PreviousItinerariesProps> = ({
  itineraries,
  isLoading,
  error,
  onSelectItinerary,
  loadingId
}) => {
  return (
    <section className="previous-itineraries-section" aria-labelledby="previous-itineraries-heading">
      <div className="container">
        <div className="previous-itineraries-card">
          <div className="previous-itineraries-header">
            <div className="previous-itineraries-title-wrap">
              <div className="section-icon-badge" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <div>
                <h2 className="previous-itineraries-heading" id="previous-itineraries-heading">
                  Previous Itineraries
                </h2>
                <p className="previous-itineraries-subtitle">
                  Your saved destination intelligence and day-by-day programs
                </p>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="history-status-state" role="status">
              <div className="history-spinner" aria-hidden="true"></div>
              <span>Loading previous itineraries...</span>
            </div>
          ) : error ? (
            <div className="history-status-state history-error-state" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{error}</span>
            </div>
          ) : itineraries.length === 0 ? (
            <div className="history-empty-state">
              <div className="history-empty-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
              </div>
              <p className="history-empty-text">No previous itineraries yet.</p>
              <p className="history-empty-sub">
                Generate your first travel itinerary above to automatically save it to your account.
              </p>
            </div>
          ) : (
            <div className="history-cards-grid" role="list" aria-label="Previous itineraries list">
              {itineraries.map((item) => {
                const isItemLoading = loadingId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`history-item-card ${isItemLoading ? 'is-loading' : ''}`}
                    onClick={() => onSelectItinerary(item.id)}
                    disabled={isItemLoading}
                    role="listitem"
                    aria-label={`Open itinerary for ${item.destination}`}
                  >
                    <div className="history-card-top">
                      <span className="history-card-dest">{item.destination}</span>
                      <span className="history-card-days">
                        {item.numberOfDays} {item.numberOfDays === 1 ? 'Day' : 'Days'}
                      </span>
                    </div>

                    <div className="history-card-meta">
                      <div className="history-meta-chip">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <span>{item.numberOfTravellers} {item.numberOfTravellers === 1 ? 'Traveller' : 'Travellers'}</span>
                      </div>

                      <div className="history-meta-chip">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>{formatHistoryDate(item.createdAt)}</span>
                      </div>
                    </div>

                    <div className="history-card-action">
                      {isItemLoading ? (
                        <span className="history-loading-text">
                          <span className="mini-spinner" aria-hidden="true"></span>
                          Loading...
                        </span>
                      ) : (
                        <span className="history-open-link">
                          View Itinerary
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                          </svg>
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
