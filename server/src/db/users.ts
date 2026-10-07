import { pool } from '../db.js';

export interface GoogleUserProfile {
  googleId: string;
  email: string;
  name: string | null;
  profilePicture: string | null;
}

export interface UserRecord {
  id: string;
  email: string | null;
  name: string | null;
  profilePicture: string | null;
  place: string | null;
}

interface UserDbRow {
  id: string;
  email: string | null;
  name: string | null;
  profile_picture: string | null;
  place: string | null;
}

interface UserEmailCheckRow {
  id: string;
  google_id: string | null;
}

/**
 * Searches for a user by google_id. If found, returns the user.
 * If not found, ensures the email does not collide with an existing account,
 * then inserts a new user record into PostgreSQL using parameterized SQL queries.
 *
 * Initializes place to NULL for newly registered Google users.
 * Never modifies the database schema or exposes database credentials.
 */
export async function findOrCreateGoogleUser(profile: GoogleUserProfile): Promise<UserRecord> {
  const { googleId, email, name, profilePicture } = profile;

  // 1. Check if user already exists by google_id
  const findByGoogleIdSql = `
    SELECT id, email, name, profile_picture, place
    FROM users
    WHERE google_id = $1
    LIMIT 1;
  `;
  const existingUserResult = await pool.query<UserDbRow>(findByGoogleIdSql, [googleId]);

  if (existingUserResult.rows.length > 0) {
    const existing = existingUserResult.rows[0];
    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      profilePicture: existing.profile_picture,
      place: existing.place
    };
  }

  // 2. Safe collision check: verify email is not already claimed by a user without matching google_id
  if (email) {
    const findByEmailSql = `
      SELECT id, google_id
      FROM users
      WHERE email = $1
      LIMIT 1;
    `;
    const emailConflictResult = await pool.query<UserEmailCheckRow>(findByEmailSql, [email]);

    if (emailConflictResult.rows.length > 0) {
      throw new Error('Account conflict: An existing user account already exists with this email address.');
    }
  }

  // 3. Create new user record (place explicitly initialized to NULL)
  const insertUserSql = `
    INSERT INTO users (google_id, email, name, profile_picture, place)
    VALUES ($1, $2, $3, $4, NULL)
    RETURNING id, email, name, profile_picture, place;
  `;
  const insertResult = await pool.query<UserDbRow>(insertUserSql, [
    googleId,
    email,
    name,
    profilePicture
  ]);

  const newUser = insertResult.rows[0];
  return {
    id: newUser.id,
    email: newUser.email,
    name: newUser.name,
    profilePicture: newUser.profile_picture,
    place: newUser.place
  };
}

/**
 * Retrieves a user by their primary key UUID.
 * Returns the full profile record including place, or null if the user does not exist.
 * Uses parameterized queries to prevent SQL injection.
 */
export async function getUserById(id: string): Promise<UserRecord | null> {
  const getUserSql = `
    SELECT id, email, name, profile_picture, place
    FROM users
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query<UserDbRow>(getUserSql, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    profilePicture: row.profile_picture,
    place: row.place
  };
}

export interface UpdateUserProfileInput {
  name?: string | null;
  place?: string | null;
}

/**
 * Updates an authenticated user's name and/or place in PostgreSQL.
 * - Updates only the row matching id ($1).
 * - Uses static parameterized SQL (no dynamic SQL concatenation).
 * - Updates updated_at to CURRENT_TIMESTAMP.
 * - Returns updated UserRecord or null if user does not exist.
 */
export async function updateUserProfile(
  id: string,
  name?: string | null | UpdateUserProfileInput,
  place?: string | null
): Promise<UserRecord | null> {
  let updateName = false;
  let nameValue: string | null = null;
  let updatePlace = false;
  let placeValue: string | null = null;

  if (typeof name === 'object' && name !== null) {
    // Called as updateUserProfile(id, { name, place })
    updateName = name.name !== undefined;
    nameValue = name.name !== undefined ? name.name : null;
    updatePlace = name.place !== undefined;
    placeValue = name.place !== undefined ? name.place : null;
  } else {
    // Called as updateUserProfile(id, name, place)
    updateName = name !== undefined;
    nameValue = name !== undefined ? name : null;
    updatePlace = place !== undefined;
    placeValue = place !== undefined ? place : null;
  }

  const updateSql = `
    UPDATE users
    SET
      name = CASE WHEN $2::boolean THEN $3 ELSE name END,
      place = CASE WHEN $4::boolean THEN $5 ELSE place END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, email, name, profile_picture, place;
  `;

  const result = await pool.query<UserDbRow>(updateSql, [
    id,
    updateName,
    nameValue,
    updatePlace,
    placeValue
  ]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    profilePicture: row.profile_picture,
    place: row.place
  };
}
