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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setErrorMessage(null);
    setInfoMessage(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
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
    setShowPassword(false);
    setShowConfirmPassword(false);
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
          // If username does NOT exist, redirect to Sign Up and inform user
          setMode('signup');
          onSwitchMode('signup');
          setPassword('');
          setConfirmPassword('');
          setShowPassword(false);
          setShowConfirmPassword(false);
          setInfoMessage('Account does not exist. Please sign up below to create your account.');
        } else {
          // If username exists but password is incorrect, remain on Login with error
          setErrorMessage(err.message || 'Invalid username or password.');
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="auth-page-wrapper">
      {/* Compact Top Navigation */}
      <nav className="auth-nav-bar" aria-label="Authentication navigation">
        <div className="container auth-nav-inner">
          <button
            type="button"
            className="auth-back-btn"
            onClick={onNavigateHome}
            aria-label="Return to TravelGenie Home"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Home</span>
          </button>

          <div className="auth-brand-badge" aria-label="TravelGenie">
            <div className="brand-badge-icon" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
              </svg>
            </div>
            <span className="auth-brand-text">TravelGenie</span>
          </div>

          <div className="auth-nav-spacer" aria-hidden="true" />
        </div>
      </nav>

      {/* Main Centered Authentication Content */}
      <main className="auth-main-content">
        <div className="auth-card-wrapper">
          <div className="auth-card">
            {/* Segmented Control Tabs */}
            <div className="auth-tabs" role="tablist" aria-label="Authentication Options">
              <button
                type="button"
                role="tab"
                id="tab-login"
                aria-selected={mode === 'login'}
                aria-controls="auth-panel"
                className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                onClick={() => handleTabSwitch('login')}
              >
                Log In
              </button>
              <button
                type="button"
                role="tab"
                id="tab-signup"
                aria-selected={mode === 'signup'}
                aria-controls="auth-panel"
                className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
                onClick={() => handleTabSwitch('signup')}
              >
                Sign Up
              </button>
            </div>

            {/* Header Titles */}
            <div className="auth-header" id="auth-panel">
              <h1 className="auth-title">
                {mode === 'signup' ? 'Create Your Account' : 'Welcome to TravelGenie'}
              </h1>
              <p className="auth-subtitle">
                {mode === 'signup'
                  ? 'Sign up to create, customize, and save your AI-powered travel itineraries.'
                  : 'Log in with your username to access the itinerary planning studio.'}
              </p>
            </div>

            {/* Info Message Alert */}
            {infoMessage && (
              <div className="auth-alert auth-alert-info" role="status">
                <svg
                  className="auth-alert-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <div className="auth-alert-text">{infoMessage}</div>
              </div>
            )}

            {/* Error Message Alert */}
            {errorMessage && (
              <div className="auth-alert auth-alert-error" role="alert">
                <svg
                  className="auth-alert-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="auth-alert-text">{errorMessage}</div>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              {/* Username Field */}
              <div className="auth-field-group">
                <label htmlFor="auth-username" className="auth-field-label">
                  Username
                </label>
                <div className="auth-input-wrapper">
                  <input
                    id="auth-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck="false"
                    className="auth-input-field"
                    placeholder={mode === 'signup' ? 'Choose a username' : 'Enter your username'}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    aria-describedby="auth-username-hint"
                    required
                  />
                </div>
                <span id="auth-username-hint" className="auth-field-hint">
                  {mode === 'signup'
                    ? '3–30 characters: letters, numbers, and underscores'
                    : 'Enter your registered username'}
                </span>
              </div>

              {/* Password Field */}
              <div className="auth-field-group">
                <label htmlFor="auth-password" className="auth-field-label">
                  Password
                </label>
                <div className="auth-input-wrapper">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    className="auth-input-field auth-input-password"
                    placeholder={mode === 'signup' ? 'Create a password' : 'Enter your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      /* Eye Off */
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" x2="22" y1="2" y2="22" />
                      </svg>
                    ) : (
                      /* Eye */
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password Field (Signup mode only) */}
              {mode === 'signup' && (
                <div className="auth-field-group">
                  <label htmlFor="auth-confirm-password" className="auth-field-label">
                    Confirm Password
                  </label>
                  <div className="auth-input-wrapper">
                    <input
                      id="auth-confirm-password"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      className="auth-input-field auth-input-password"
                      placeholder="Confirm your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button
                      type="button"
                      className="auth-password-toggle-btn"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      title={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      {showConfirmPassword ? (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      ) : (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Submit Button */}
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

            {/* Bottom Switch Link */}
            <div className="auth-switch-footer">
              {mode === 'login' ? (
                <p>
                  Don&rsquo;t have an account?{' '}
                  <button
                    type="button"
                    className="auth-switch-btn"
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
                    className="auth-switch-btn"
                    onClick={() => handleTabSwitch('login')}
                  >
                    Log In
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
