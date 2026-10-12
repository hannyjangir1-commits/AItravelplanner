-- Migration 004: Enforce case-insensitive username uniqueness on users table
-- Prevents case-variation duplicate accounts and race conditions during user signup.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower_unique ON users (LOWER(username)) WHERE username IS NOT NULL;
