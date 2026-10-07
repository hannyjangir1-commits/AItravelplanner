-- Migration 003: Add username and password_hash columns to users table
-- Enables username + password authentication for TravelGenie.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Unique index on username to enforce account uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);

-- Index on username for fast lookup
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
