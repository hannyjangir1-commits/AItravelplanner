import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../types';
import { updateUserProfile, logoutUser } from '../api';

interface ProfileMenuProps {
  user: UserProfile;
  onUpdateUser: (updatedUser: UserProfile) => void;
  onLogout: () => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ user, onUpdateUser, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(user.name || '');
  const [placeInput, setPlaceInput] = useState(user.place || '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Sync inputs if user prop updates
  useEffect(() => {
    setNameInput(user.name || '');
    setPlaceInput(user.place || '');
  }, [user]);

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsEditing(false);
        setErrorMessage(null);
        setSuccessMessage(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setIsEditing(false);
        setErrorMessage(null);
        setSuccessMessage(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleOpen = () => {
    setIsOpen((prev) => {
      if (prev) {
        setIsEditing(false);
        setErrorMessage(null);
        setSuccessMessage(null);
      }
      return !prev;
    });
  };

  const handleStartEdit = () => {
    setNameInput(user.name || '');
    setPlaceInput(user.place || '');
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setNameInput(user.name || '');
    setPlaceInput(user.place || '');
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsEditing(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedUser = await updateUserProfile({
        name: nameInput.trim(),
        place: placeInput.trim()
      });
      onUpdateUser(updatedUser);
      setSuccessMessage('Profile saved successfully.');
      setTimeout(() => {
        setIsEditing(false);
        setSuccessMessage(null);
      }, 700);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoutClick = async () => {
    try {
      await logoutUser();
    } finally {
      onLogout();
      setIsOpen(false);
    }
  };

  // Profile icon must contain the uppercase first character of username
  const avatarLetter = (user.username || user.name || 'U').charAt(0).toUpperCase();

  return (
    <div className="profile-menu-wrapper" ref={menuRef}>
      {/* Circular Profile Avatar Button */}
      <button
        type="button"
        className="profile-avatar-btn"
        onClick={toggleOpen}
        aria-label={`User profile for ${user.username}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title={`Logged in as ${user.username}`}
      >
        <span className="profile-avatar-fallback" aria-hidden="true">
          {avatarLetter}
        </span>
      </button>

      {/* Dropdown Menu / Popover */}
      {isOpen && (
        <div className="profile-popover" role="dialog" aria-label="User profile">
          {!isEditing ? (
            /* VIEW MODE */
            <div className="profile-view-pane">
              <div className="profile-header-card">
                <div className="profile-card-avatar">
                  <span className="profile-card-fallback">{avatarLetter}</span>
                </div>
                <div className="profile-card-info">
                  <div className="profile-card-name">{user.name || user.username}</div>
                  <div className="profile-card-email">@{user.username}</div>
                </div>
              </div>

              <div className="profile-meta-section">
                <div className="profile-meta-row">
                  <span className="profile-meta-label">Location / City</span>
                  <span className="profile-meta-val">
                    {user.place ? user.place : <span className="profile-meta-empty">Not set</span>}
                  </span>
                </div>
              </div>

              <div className="profile-popover-actions">
                <button
                  type="button"
                  className="btn-profile-action btn-profile-edit"
                  onClick={handleStartEdit}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  <span>Edit Profile</span>
                </button>

                <button
                  type="button"
                  className="btn-profile-action btn-profile-logout"
                  onClick={handleLogoutClick}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          ) : (
            /* EDIT MODE */
            <form onSubmit={handleSaveProfile} className="profile-edit-form">
              <div className="profile-edit-heading">Edit Profile</div>

              {errorMessage && (
                <div className="profile-alert-box profile-alert-error" role="alert">
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div className="profile-alert-box profile-alert-success" role="status">
                  {successMessage}
                </div>
              )}

              <div className="profile-field-group">
                <label className="profile-field-label">Username</label>
                <div className="profile-readonly-email">@{user.username}</div>
              </div>

              <div className="profile-field-group">
                <label htmlFor="profile-name-input" className="profile-field-label">
                  Display Name
                </label>
                <input
                  id="profile-name-input"
                  type="text"
                  className="profile-field-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={255}
                  placeholder="Your display name"
                  disabled={isSaving}
                />
              </div>

              <div className="profile-field-group">
                <label htmlFor="profile-place-input" className="profile-field-label">
                  Home City / Place
                </label>
                <input
                  id="profile-place-input"
                  type="text"
                  className="profile-field-input"
                  value={placeInput}
                  onChange={(e) => setPlaceInput(e.target.value)}
                  maxLength={255}
                  placeholder="e.g. Pune, Mumbai, London"
                  disabled={isSaving}
                />
              </div>

              <div className="profile-form-buttons">
                <button
                  type="button"
                  className="btn-profile-secondary"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-profile-primary"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
