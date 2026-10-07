import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import { signupUser, loginUser, type AuthApiError } from '../api';

interface AuthPageProps {
  initialMode: 'login' | 'signup';
  onAuthSuccess: (user: UserProfile) => void;
  onNavigateHome: () => void;
  onSwitchMode: (mode: 'login' | 'signup') => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  initialMode,
  onAuthSuccess,
  onNavigateHome,
  onSwitchMode
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setErrorMessage(null);
    setInfoMessage(null);
  }, [initialMode]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.title = mode === 'signup'
      ? 'Sign Up — TravelGenie'
      : 'Log In — TravelGenie';
    return () => {
      document.title = 'TravelGenie - Destination Planning Intelligence';
    };
  }, [mode]);

  const handleTabSwitch = (newMode: 'login' | 'signup') => {
    setMode(newMode);
    setErrorMessage(null);
    setInfoMessage(null);
    setPassword('');
    setConfirmPassword('');
    onSwitchMode(newMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setErrorMessage(null);
    setInfoMessage(null);

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setErrorMessage('Please enter your username.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    if (mode === 'signup') {
      if (cleanUsername.length < 3 || cleanUsername.length > 30) {
        setErrorMessage('Username must be between 3 and 30 characters.');
        return;
      }

      if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
        setErrorMessage('Username can only contain letters, numbers, and underscores.');
        return;
      }

      if (password.length < 8) {
        setErrorMessage('Password must be at least 8 characters long.');
        return;
      }

      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match. Please verify.');
        return;
      }

      setIsLoading(true);
      try {
        const user = await signupUser(cleanUsername, password);
        onAuthSuccess(user);
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to create account. Please try again.');
      } finally {
        setIsLoading(false);
      }
    } else {
      // Login mode
      setIsLoading(true);
      try {
        const user = await loginUser(cleanUsername, password);
        onAuthSuccess(user);
      } catch (err: any) {
        const authErr = err as AuthApiError;
        if (authErr.isNotFound) {
          // Requirement: If username does NOT exist, redirect/show the Sign Up mode and clearly inform the user
          setMode('signup');
          onSwitchMode('signup');
          setPassword('');
          setConfirmPassword('');
          setInfoMessage('Account does not exist. Please sign up below to create your account.');
        } else {
          // Requirement: If username exists but password is incorrect, remain on Login with error
          setErrorMessage(err.message || 'Invalid username or password.');
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="auth-page-wrapper">
      <nav className="auth-nav-bar" aria-label="Authentication navigation">
        <div className="container auth-nav-inner">
          <button
            type="button"
            className="legal-back-btn"
            onClick={onNavigateHome}
            aria-label="Return to TravelGenie Home"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Back to Home</span>
          </button>

          <div className="brand-text-block" style={{ textAlign: 'center' }}>
            <span className="brand-title" style={{ fontSize: '1.05rem' }}>TravelGenie</span>
          </div>

          <div style={{ width: '90px' }} />
        </div>
      </nav>

      <main className="container auth-container">
        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="Authentication Options">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('login')}
            >
              Log In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('signup')}
            >
              Sign Up
            </button>
          </div>

          <div className="auth-header">
            <h1 className="auth-title">
              {mode === 'signup' ? 'Create Your Account' : 'Welcome to TravelGenie'}
            </h1>
            <p className="auth-subtitle">
              {mode === 'signup'
                ? 'Sign up to create, customize, and save your AI-powered travel itineraries.'
                : 'Log in with your username to access the itinerary planning studio.'}
            </p>
          </div>

          {infoMessage && (
            <div className="alert-box alert-info" role="status" style={{ marginBottom: '1.25rem' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <span>{infoMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="alert-box alert-error" role="alert" style={{ marginBottom: '1.25rem' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="field-group">
              <label htmlFor="auth-username" className="field-label">
                Username
              </label>
              <input
                id="auth-username"
                name="username"
                type="text"
                autoComplete="username"
                className="input-field"
                placeholder="e.g. hanny"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
              />
              <span className="field-hint">
                {mode === 'signup'
                  ? '3–30 characters (letters, numbers, underscores)'
                  : 'Enter your registered username'}
              </span>
            </div>

            <div className="field-group">
              <label htmlFor="auth-password" className="field-label">
                Password
              </label>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="input-field"
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            {mode === 'signup' && (
              <div className="field-group">
                <label htmlFor="auth-confirm-password" className="field-label">
                  Confirm Password
                </label>
                <input
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  className="input-field"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            )}

            <button
              type="submit"
              className="btn-auth-submit"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="mini-spinner" aria-hidden="true" />
                  <span>{mode === 'signup' ? 'Creating Account...' : 'Logging In...'}</span>
                </>
              ) : (
                <span>{mode === 'signup' ? 'Sign Up' : 'Log In'}</span>
              )}
            </button>
          </form>

          <div className="auth-switch-footer">
            {mode === 'login' ? (
              <p>
                Don&rsquo;t have an account?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => handleTabSwitch('signup')}
                >
                  Sign Up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => handleTabSwitch('login')}
                >
                  Log In
                </button>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
