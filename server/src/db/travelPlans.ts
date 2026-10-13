import { randomUUID } from 'crypto';
import { pool } from '../db.js';
import { GeneratePlanRequest, TravelPlan } from '../types.js';

export interface SavedTravelPlanResult {
  id: string;
  createdAt: string;
}

interface InMemoryPlan {
  id: string;
  userId: string;
  destination: string;
  numberOfDays: number;
  budgetInr: number;
  numberOfTravellers: number;
  interests: string[];
  accommodationPreference: string;
  activityLevel: string;
  additionalNotes: string | null;
  planData: TravelPlan;
  createdAt: string;
  updatedAt: string;
}

const memPlans = new Map<string, InMemoryPlan>();

/**
 * Inserts a successfully generated travel plan into the PostgreSQL travel_plans table.
 *
 * Security & Design Rules:
 * - Uses parameterized SQL exclusively ($1 .. $10).
 * - userId must come strictly from authenticated session (req.user.userId).
 * - Never trusts or accepts user_id from client request body or parameters.
 * - Stores interests and complete plan structure as JSONB.
 * - Returns the newly created travel plan UUID and created_at timestamp.
 */
export async function saveTravelPlan(
  userId: string,
  details: GeneratePlanRequest,
  plan: TravelPlan
): Promise<SavedTravelPlanResult> {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Valid authenticated user ID is required to save travel plan.');
  }

  const insertSql = `
    INSERT INTO travel_plans (
      user_id,
      destination,
      number_of_days,
      budget_inr,
      number_of_travellers,
      interests,
      accommodation_preference,
      activity_level,
      additional_notes,
      plan_data
    ) VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb
    )
    RETURNING id, created_at;
  `;

  // Guarantee includeDayByDayItinerary is explicitly preserved on the saved plan JSON
  const planToSave: TravelPlan = {
    ...plan,
    includeDayByDayItinerary: typeof plan.includeDayByDayItinerary === 'boolean'
      ? plan.includeDayByDayItinerary
      : (details.includeDayByDayItinerary ?? (Array.isArray(plan.itinerary) && plan.itinerary.length > 0))
  };

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is not configured. PostgreSQL is strictly required in production.');
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    memPlans.set(id, {
      id,
      userId: userId.trim(),
      destination: details.destination.trim(),
      numberOfDays: details.numberOfDays,
      budgetInr: details.budgetInr,
      numberOfTravellers: details.numberOfTravellers,
      interests: details.interests || [],
      accommodationPreference: details.accommodationPreference,
      activityLevel: details.activityLevel,
      additionalNotes: details.additionalNotes ? details.additionalNotes.trim() : null,
      planData: planToSave,
      createdAt: now,
      updatedAt: now
    });
    return {
      id,
      createdAt: now
    };
  }

  const values = [
    userId.trim(),
    details.destination.trim(),
    details.numberOfDays,
    details.budgetInr,
    details.numberOfTravellers,
    JSON.stringify(details.interests || []),
    details.accommodationPreference,
    details.activityLevel,
    details.additionalNotes ? details.additionalNotes.trim() : null,
    JSON.stringify(planToSave)
  ];

  const result = await pool.query<{ id: string; created_at: Date | string }>(insertSql, values);
  const row = result.rows[0];

  return {
    id: row.id,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString()
  };
}

export interface CompactItinerarySummary {
  id: string;
  destination: string;
  numberOfDays: number;
  numberOfTravellers: number;
  createdAt: string;
}

interface TravelPlanSummaryRow {
  id: string;
  destination: string;
  number_of_days: number;
  number_of_travellers: number;
  created_at: Date | string;
}

/**
 * Retrieves a compact summary list of saved travel plans for the authenticated user.
 *
 * Security & Query Design:
 * - Strictly filters by WHERE user_id = $1 to guarantee user isolation.
 * - Orders by created_at DESC (newest first).
 * - Excludes the large plan_data JSONB payload to keep response lightweight.
 * - Parameterized SQL only, no dynamic queries or client-provided SQL.
 */
export async function getTravelPlansByUserId(userId: string): Promise<CompactItinerarySummary[]> {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Valid authenticated user ID is required to fetch travel plans.');
  }

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is not configured. PostgreSQL is strictly required in production.');
    }
    return Array.from(memPlans.values())
      .filter((p) => p.userId === userId.trim())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((p) => ({
        id: p.id,
        destination: p.destination,
        numberOfDays: p.numberOfDays,
        numberOfTravellers: p.numberOfTravellers,
        createdAt: p.createdAt
      }));
  }

  const querySql = `
    SELECT id, destination, number_of_days, number_of_travellers, created_at
    FROM travel_plans
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 100;
  `;

  const result = await pool.query<TravelPlanSummaryRow>(querySql, [userId.trim()]);

  return result.rows.map((row) => ({
    id: row.id,
    destination: row.destination,
    numberOfDays: row.number_of_days,
    numberOfTravellers: row.number_of_travellers,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString()
  }));
}

export interface DetailedItineraryRecord {
  id: string;
  destination: string;
  numberOfDays: number;
  budgetInr: number;
  numberOfTravellers: number;
  interests: string[];
  accommodationPreference: string;
  activityLevel: string;
  additionalNotes: string | null;
  includeDayByDayItinerary?: boolean;
  plan: TravelPlan;
  createdAt: string;
  updatedAt: string;
}

interface TravelPlanDetailRow {
  id: string;
  destination: string;
  number_of_days: number;
  budget_inr: string | number;
  number_of_travellers: number;
  interests: any;
  accommodation_preference: string;
  activity_level: string;
  additional_notes: string | null;
  plan_data: any;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Retrieves a single complete saved travel plan belonging strictly to the authenticated user.
 *
 * CRITICAL SECURITY REQUIREMENT:
 * Enforces ownership directly within the parameterized SQL query:
 * WHERE id = $1 AND user_id = $2
 * Never queries only by itinerary ID.
 * Returns null if the itinerary does not exist OR belongs to another user.
 */
export async function getTravelPlanByIdForUser(
  id: string,
  userId: string
): Promise<DetailedItineraryRecord | null> {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error('Valid itinerary ID is required.');
  }
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Valid authenticated user ID is required.');
  }

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is not configured. PostgreSQL is strictly required in production.');
    }
    const p = memPlans.get(id.trim());
    if (!p || p.userId !== userId.trim()) {
      return null;
    }
    return {
      id: p.id,
      destination: p.destination,
      numberOfDays: p.numberOfDays,
      budgetInr: p.budgetInr,
      numberOfTravellers: p.numberOfTravellers,
      interests: p.interests,
      accommodationPreference: p.accommodationPreference,
      activityLevel: p.activityLevel,
      additionalNotes: p.additionalNotes,
      includeDayByDayItinerary: p.planData.includeDayByDayItinerary ?? (Array.isArray(p.planData.itinerary) && p.planData.itinerary.length > 0),
      plan: p.planData,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  }

  const querySql = `
    SELECT
      id,
      destination,
      number_of_days,
      budget_inr,
      number_of_travellers,
      interests,
      accommodation_preference,
      activity_level,
      additional_notes,
      plan_data,
      created_at,
      updated_at
    FROM travel_plans
    WHERE id = $1
      AND user_id = $2
    LIMIT 1;
  `;

  const result = await pool.query<TravelPlanDetailRow>(querySql, [id.trim(), userId.trim()]);
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  const parsedInterests = typeof row.interests === 'string'
    ? JSON.parse(row.interests)
    : row.interests;

  const parsedPlan = typeof row.plan_data === 'string'
    ? JSON.parse(row.plan_data)
    : row.plan_data;

  return {
    id: row.id,
    destination: row.destination,
    numberOfDays: row.number_of_days,
    budgetInr: Number(row.budget_inr),
    numberOfTravellers: row.number_of_travellers,
    interests: Array.isArray(parsedInterests) ? parsedInterests : [],
    accommodationPreference: row.accommodation_preference,
    activityLevel: row.activity_level,
    additionalNotes: row.additional_notes || null,
    includeDayByDayItinerary: parsedPlan?.includeDayByDayItinerary ?? (Array.isArray(parsedPlan?.itinerary) && parsedPlan.itinerary.length > 0),
    plan: parsedPlan as TravelPlan,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

export interface UpdatedTravelPlanResult {
  id: string;
  updatedAt: string;
}

/**
 * Updates an existing saved travel plan's plan_data JSONB and updated_at timestamp.
 *
 * CRITICAL SECURITY & DATA ISOLATION:
 * - Scoped strictly to both itinerary ID and authenticated user ID:
 *   WHERE id = $2 AND user_id = $3
 * - Returns null if the itinerary does not exist OR belongs to another user.
 * - Guarantees parameterized SQL.
 */
export async function updateSavedTravelPlan(
  id: string,
  userId: string,
  updatedPlan: TravelPlan
): Promise<UpdatedTravelPlanResult | null> {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error('Valid itinerary ID is required to update travel plan.');
  }
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Valid authenticated user ID is required to update travel plan.');
  }

  const planToSave: TravelPlan = {
    ...updatedPlan,
    includeDayByDayItinerary: typeof updatedPlan.includeDayByDayItinerary === 'boolean'
      ? updatedPlan.includeDayByDayItinerary
      : (Array.isArray(updatedPlan.itinerary) && updatedPlan.itinerary.length > 0)
  };

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is not configured. PostgreSQL is strictly required in production.');
    }
    const p = memPlans.get(id.trim());
    if (!p || p.userId !== userId.trim()) {
      return null;
    }
    const now = new Date().toISOString();
    p.planData = planToSave;
    p.updatedAt = now;
    return {
      id: p.id,
      updatedAt: now
    };
  }

  const updateSql = `
    UPDATE travel_plans
    SET
      plan_data = $1::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND user_id = $3
    RETURNING id, updated_at;
  `;

  const result = await pool.query<{ id: string; updated_at: Date | string }>(updateSql, [
    JSON.stringify(planToSave),
    id.trim(),
    userId.trim()
  ]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

/**
 * Deletes a saved travel plan belonging strictly to the authenticated user.
 *
 * CRITICAL SECURITY & DATA ISOLATION:
 * - Scoped strictly to both itinerary ID and authenticated user ID:
 *   WHERE id = $1 AND user_id = $2
 * - Never deletes across users or allows ID-only deletion.
 */
export async function deleteTravelPlanForUser(
  id: string,
  userId: string
): Promise<boolean> {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error('Valid itinerary ID is required to delete travel plan.');
  }
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Valid authenticated user ID is required to delete travel plan.');
  }

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is not configured. PostgreSQL is strictly required in production.');
    }
    const p = memPlans.get(id.trim());
    if (!p || p.userId !== userId.trim()) {
      return false;
    }
    memPlans.delete(id.trim());
    return true;
  }

  const deleteSql = `
    DELETE FROM travel_plans
    WHERE id = $1 AND user_id = $2
    RETURNING id;
  `;

  const result = await pool.query(deleteSql, [id.trim(), userId.trim()]);
  return (result.rowCount ?? 0) > 0;
}
