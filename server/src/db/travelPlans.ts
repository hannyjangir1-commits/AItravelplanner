import { pool } from '../db.js';
import { GeneratePlanRequest, TravelPlan } from '../types.js';

export interface SavedTravelPlanResult {
  id: string;
  createdAt: string;
}

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
    JSON.stringify(plan)
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

  const querySql = `
    SELECT id, destination, number_of_days, number_of_travellers, created_at
    FROM travel_plans
    WHERE user_id = $1
    ORDER BY created_at DESC;
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
    plan: parsedPlan as TravelPlan,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}
