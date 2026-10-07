import { pool } from '../db.js';

export interface UserRecord {
  id: string;
  username: string;
  name: string | null;
  place: string | null;
  email?: string | null;
  profilePicture?: string | null;
}

export interface UserWithPassword extends UserRecord {
  passwordHash: string;
}

export interface GoogleUserProfile {
  googleId: string;
  email: string;
  name: string | null;
  profilePicture: string | null;
}

interface UserDbRow {
  id: string;
  username: string | null;
  password_hash?: string;
  email: string | null;
  name: string | null;
  profile_picture: string | null;
  place: string | null;
}

/**
 * Creates a new user record in PostgreSQL with a hashed password.
 * Guaranteed unique username.
 * Never returns password_hash to callers.
 */
export async function createUser(username: string, passwordHash: string): Promise<UserRecord> {
  const insertSql = `
    INSERT INTO users (username, password_hash)
    VALUES ($1, $2)
    RETURNING id, username, name, place;
  `;
  const result = await pool.query<UserDbRow>(insertSql, [username.trim(), passwordHash]);
  const row = result.rows[0];
  return {
    id: row.id,
    username: row.username || username.trim(),
    name: row.name || null,
    place: row.place || null
  };
}

/**
 * Retrieves a user by case-insensitive username, including their password hash for auth verification.
 * Only used internally for sign-in comparison.
 */
export async function getUserByUsername(username: string): Promise<UserWithPassword | null> {
  const sql = `
    SELECT id, username, password_hash, name, place
    FROM users
    WHERE LOWER(username) = LOWER($1)
    LIMIT 1;
  `;
  const result = await pool.query<UserDbRow>(sql, [username.trim()]);
  if (result.rows.length === 0 || !result.rows[0].password_hash) {
    return null;
  }
  const row = result.rows[0];
  if (!row.password_hash) {
    return null;
  }
  return {
    id: row.id,
    username: row.username || username.trim(),
    passwordHash: row.password_hash,
    name: row.name || null,
    place: row.place || null
  };
}

/**
 * Retrieves a user by primary key UUID.
 * Never exposes password_hash.
 */
export async function getUserById(id: string): Promise<UserRecord | null> {
  const getUserSql = `
    SELECT id, username, name, place, email, profile_picture
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
    username: row.username || (row.email ? row.email.split('@')[0] : 'user'),
    name: row.name || null,
    place: row.place || null,
    email: row.email || null,
    profilePicture: row.profile_picture || null
  };
}

export interface UpdateUserProfileInput {
  name?: string | null;
  place?: string | null;
}

/**
 * Updates an authenticated user's name and/or place in PostgreSQL.
 * Parameterized query; never modifies credentials or unauthorized fields.
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
    updateName = name.name !== undefined;
    nameValue = name.name !== undefined ? name.name : null;
    updatePlace = name.place !== undefined;
    placeValue = name.place !== undefined ? name.place : null;
  } else {
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
    RETURNING id, username, name, place;
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
    username: row.username || 'user',
    name: row.name || null,
    place: row.place || null
  };
}

/**
 * Kept for database compatibility if any legacy records exist.
 */
export async function findOrCreateGoogleUser(profile: GoogleUserProfile): Promise<UserRecord> {
  const { googleId, email, name, profilePicture } = profile;
  const findByGoogleIdSql = `
    SELECT id, username, email, name, profile_picture, place
    FROM users
    WHERE google_id = $1
    LIMIT 1;
  `;
  const existingUserResult = await pool.query<UserDbRow>(findByGoogleIdSql, [googleId]);

  if (existingUserResult.rows.length > 0) {
    const existing = existingUserResult.rows[0];
    return {
      id: existing.id,
      username: existing.username || (email ? email.split('@')[0] : 'user'),
      email: existing.email,
      name: existing.name,
      profilePicture: existing.profile_picture,
      place: existing.place
    };
  }

  const username = email ? email.split('@')[0] : `user_${googleId.slice(0, 8)}`;
  const insertUserSql = `
    INSERT INTO users (google_id, username, email, name, profile_picture, place)
    VALUES ($1, $2, $3, $4, $5, NULL)
    RETURNING id, username, email, name, profile_picture, place;
  `;
  const insertResult = await pool.query<UserDbRow>(insertUserSql, [
    googleId,
    username,
    email,
    name,
    profilePicture
  ]);

  const newUser = insertResult.rows[0];
  return {
    id: newUser.id,
    username: newUser.username || username,
    email: newUser.email,
    name: newUser.name,
    profilePicture: newUser.profile_picture,
    place: newUser.place
  };
}
