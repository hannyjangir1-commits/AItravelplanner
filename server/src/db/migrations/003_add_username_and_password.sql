-- Migration 003: Add username and password_hash columns to users table
-- Enables username + password authentication for TravelGenie.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index on username for fast case-insensitive lookup
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
