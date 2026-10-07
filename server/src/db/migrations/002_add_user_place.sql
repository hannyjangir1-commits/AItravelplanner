-- Migration 002: Add place column to users table
-- Non-destructive, idempotent migration for user profile customization
-- Allows each user to store their home city or location preference.

ALTER TABLE users ADD COLUMN IF NOT EXISTS place VARCHAR(255);
