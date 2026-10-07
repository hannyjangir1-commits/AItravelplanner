import { Router, Request, Response } from 'express';
import { signAuthToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createUser, getUserByUsername, getUserById, updateUserProfile } from '../db/users.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const AUTH_TOKEN_COOKIE = 'travelgenie_auth';
const AUTH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * POST /api/auth/signup
 * Registers a new user with username and password.
 * Hashes password securely, creates database record, and issues JWT session cookie.
 */
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body || {};

    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required.' });
      return;
    }

    const cleanUsername = username.trim();
    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
      res.status(400).json({ error: 'Username must be between 3 and 30 characters.' });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
      return;
    }

    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    // Uniqueness check
    const existing = await getUserByUsername(cleanUsername);
    if (existing) {
      res.status(409).json({ error: 'Username is already taken. Please choose another.' });
      return;
    }

    // Securely hash password using scrypt
    const passwordHash = await hashPassword(password);
    const user = await createUser(cleanUsername, passwordHash);

    // Issue application-level JWT
    const appToken = signAuthToken({
      userId: user.id,
      username: user.username
    });

    // Set secure HTTP-only cookie
    res.cookie(AUTH_TOKEN_COOKIE, appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_TOKEN_MAX_AGE_MS
    });

    res.status(201).json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        place: user.place
      }
    });
  } catch (error: any) {
    console.error('[Signup Route Error]:', {
      message: error?.message || String(error),
      code: error?.code,
      detail: error?.detail,
      column: error?.column,
      table: error?.table,
      constraint: error?.constraint
    });

    if (error?.code === '23505') {
      res.status(409).json({ error: 'Username is already taken. Please choose another.' });
      return;
    }

    res.status(500).json({ error: 'Failed to create account. Please try again later.' });
  }
});

/**
 * POST /api/auth/signin
 * Authenticates user with username and password.
 * - If username does NOT exist: returns 404 with notFound flag to prompt Sign Up.
 * - If username exists but password is incorrect: returns 401 without redirecting.
 * - If credentials match: issues JWT session cookie.
 */
router.post('/signin', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body || {};

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const cleanUsername = username.trim();
    const user = await getUserByUsername(cleanUsername);

    if (!user) {
      res.status(404).json({
        error: 'Account does not exist. Please sign up.',
        notFound: true
      });
      return;
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({
        error: 'Invalid username or password.'
      });
      return;
    }

    // Issue application-level JWT
    const appToken = signAuthToken({
      userId: user.id,
      username: user.username
    });

    res.cookie(AUTH_TOKEN_COOKIE, appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_TOKEN_MAX_AGE_MS
    });

    res.status(200).json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        place: user.place
      }
    });
  } catch (error: any) {
    console.error('[Signin Route Error]:', {
      message: error?.message || String(error),
      code: error?.code,
      detail: error?.detail
    });
    res.status(500).json({ error: 'Failed to sign in. Please try again later.' });
  }
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's safe profile.
 * Never exposes password_hash or credentials.
 */
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.user.userId) {
    res.status(401).json({ authenticated: false });
    return;
  }

  try {
    const user = await getUserById(req.user.userId);
    if (!user) {
      res.status(401).json({ authenticated: false });
      return;
    }

    res.status(200).json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        place: user.place
      }
    });
  } catch (error) {
    console.error('[Get Profile Error]:', error);
    res.status(500).json({
      authenticated: false,
      error: 'An unexpected internal error occurred.'
    });
  }
});

/**
 * POST /api/auth/logout
 * Clears the travelgenie_auth cookie.
 */
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie(AUTH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });

  res.status(200).json({
    success: true
  });
});

/**
 * PATCH /api/auth/profile
 * Allows the authenticated user to update their display name and/or place.
 */
router.patch('/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.user.userId) {
    res.status(401).json({ authenticated: false });
    return;
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a valid JSON object.' });
    return;
  }

  // Reject modifications to sensitive fields
  const DISALLOWED_FIELDS = [
    'id',
    'username',
    'password',
    'password_hash',
    'google_id',
    'googleId',
    'email',
    'created_at',
    'updated_at'
  ];
  for (const field of DISALLOWED_FIELDS) {
    if (field in req.body) {
      res.status(400).json({ error: `Field '${field}' cannot be modified.` });
      return;
    }
  }

  let sanitizedName: string | null | undefined = undefined;
  if ('name' in req.body) {
    if (typeof req.body.name !== 'string') {
      res.status(400).json({ error: 'Field "name" must be a string.' });
      return;
    }
    const trimmed = req.body.name.trim();
    if (trimmed.length > 255) {
      res.status(400).json({ error: 'Field "name" must not exceed 255 characters.' });
      return;
    }
    sanitizedName = trimmed.length > 0 ? trimmed : null;
  }

  let sanitizedPlace: string | null | undefined = undefined;
  if ('place' in req.body) {
    if (typeof req.body.place !== 'string') {
      res.status(400).json({ error: 'Field "place" must be a string.' });
      return;
    }
    const trimmed = req.body.place.trim();
    if (trimmed.length > 255) {
      res.status(400).json({ error: 'Field "place" must not exceed 255 characters.' });
      return;
    }
    sanitizedPlace = trimmed.length > 0 ? trimmed : null;
  }

  if (sanitizedName === undefined && sanitizedPlace === undefined) {
    res.status(400).json({ error: 'At least one field (name or place) must be provided.' });
    return;
  }

  try {
    const updatedUser = await updateUserProfile(req.user.userId, sanitizedName, sanitizedPlace);

    if (!updatedUser) {
      res.status(404).json({
        authenticated: false,
        message: 'User not found'
      });
      return;
    }

    res.status(200).json({
      authenticated: true,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        name: updatedUser.name,
        place: updatedUser.place
      }
    });
  } catch (error) {
    console.error('[Update Profile Route Error]:', error);
    res.status(500).json({
      authenticated: false,
      error: 'Failed to update profile. Please try again later.'
    });
  }
});

export default router;
