import React from 'react';
import type { UserProfile } from '../types';
import { ProfileMenu } from './ProfileMenu';

interface HeaderProps {
  onNewPlan?: () => void;
  hasPlan?: boolean;
  user?: UserProfile | null;
  onUpdateUser?: (updatedUser: UserProfile) => void;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onNewPlan,
  hasPlan,
  user,
  onUpdateUser,
  onLogout
}) => {
  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google';
  };

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

          {user && onUpdateUser && onLogout ? (
            <ProfileMenu
              user={user}
              onUpdateUser={onUpdateUser}
              onLogout={onLogout}
            />
          ) : !user ? (
            <button
              type="button"
              className="btn-google-login"
              onClick={handleGoogleLogin}
              title="Sign in with Google"
              aria-label="Continue with Google"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
              <span>Continue with Google</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
};
