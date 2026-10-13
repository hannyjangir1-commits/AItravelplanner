-- =============================================================================
-- Migration 001: Initial Relational Schema for TravelGenie
-- Creates schema_migrations, users, travel_plans, constraints, and indexes
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64) NULL
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NULL,
    password_hash TEXT NULL,
    google_id VARCHAR(255) NULL UNIQUE,
    name VARCHAR(255) NULL,
    email VARCHAR(255) NULL UNIQUE,
    profile_picture TEXT NULL,
    place VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_has_identity CHECK (
        username IS NOT NULL OR google_id IS NOT NULL OR email IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower_unique
    ON users (LOWER(username))
    WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_username
    ON users (username);

CREATE INDEX IF NOT EXISTS idx_users_email
    ON users (email)
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_google_id
    ON users (google_id)
    WHERE google_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS travel_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination VARCHAR(255) NOT NULL,
    number_of_days INTEGER NOT NULL CONSTRAINT chk_travel_plans_days CHECK (number_of_days > 0 AND number_of_days <= 90),
    budget_inr NUMERIC NOT NULL CONSTRAINT chk_travel_plans_budget CHECK (budget_inr >= 0),
    number_of_travellers INTEGER NOT NULL CONSTRAINT chk_travel_plans_travellers CHECK (number_of_travellers > 0 AND number_of_travellers <= 100),
    interests JSONB NOT NULL DEFAULT '[]'::jsonb,
    accommodation_preference VARCHAR(50) NOT NULL,
    activity_level VARCHAR(50) NOT NULL,
    additional_notes TEXT NULL,
    plan_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_travel_plans_user_id
    ON travel_plans (user_id);

CREATE INDEX IF NOT EXISTS idx_travel_plans_created_at
    ON travel_plans (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_travel_plans_user_created
    ON travel_plans (user_id, created_at DESC);
