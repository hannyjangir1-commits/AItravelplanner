import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { signAuthToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createUser, getUserByUsername, getUserById, updateUserProfile } from '../db/users.js';
import { requireAuth } from '../middleware/auth.js';
import { getCsrfTokenEndpoint, CSRF_COOKIE_NAME, generateCsrfToken } from '../middleware/csrf.js';

const router = Router();

const AUTH_TOKEN_COOKIE = 'travelgenie_auth';
const AUTH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Precomputed dummy scrypt hash for timing-attack mitigation when username does not exist
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Authentication rate limiters
export const signinRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many sign-in attempts from your network. Please try again after 15 minutes.'
  }
});

export const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many account creation requests from your network. Please try again later.'
  }
});

export const profileRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many profile update requests. Please try again later.'
  }
});

/**
 * GET /api/auth/csrf
 * Returns current anti-CSRF token and ensures cookie is set.
 */
router.get('/csrf', getCsrfTokenEndpoint);

/**
 * Helper to ensure travelgenie_csrf cookie is seeded on successful authentication
 */
function seedCsrfCookie(req: Request, res: Response): void {
  if (!req.cookies?.[CSRF_COOKIE_NAME] || req.cookies[CSRF_COOKIE_NAME].length !== 64) {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
  }
}

/**
 * POST /api/auth/signup
 * Registers a new user with username and password.
 * Hashes password securely, creates database record, and issues JWT session cookie.
 */
router.post('/signup', signupRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body || {};

    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required.' });
      return;
    }

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
      res.status(400).json({ error: 'Username must be between 3 and 30 characters.' });
      return;
    }

    if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
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

    seedCsrfCookie(req, res);

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
      code: error?.code
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
 * Security: Returns consistent 401 error response for non-existent users and invalid passwords.
 * Uses timingSafe verification against dummy hash when user is absent to mitigate timing attacks.
 */
router.post('/signin', signinRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body || {};

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = await getUserByUsername(cleanUsername);

    if (!user) {
      // Execute constant-work verification to prevent timing attack enumeration
      await verifyPassword(password, DUMMY_HASH);
      res.status(401).json({
        error: 'Invalid username or password.'
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

    seedCsrfCookie(req, res);

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
      code: error?.code
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
router.patch('/profile', requireAuth, profileRateLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.user.userId) {
    res.status(401).json({ authenticated: false });
    return;
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a valid JSON object.' });
    return;
  }

  // Allow ONLY explicitly editable profile fields ('name' and 'place').
  // Strictly rejects unknown fields, sensitive fields, and identity fields (id, email, password, etc.).
  const ALLOWED_FIELDS = new Set(['name', 'place']);
  for (const key of Object.keys(req.body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      res.status(400).json({ error: `Field '${key}' is not allowed or cannot be modified.` });
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
    if (trimmed.length > 100) {
      res.status(400).json({ error: 'Field "name" must not exceed 100 characters.' });
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
    if (trimmed.length > 100) {
      res.status(400).json({ error: 'Field "place" must not exceed 100 characters.' });
      return;
    }
    sanitizedPlace = trimmed.length > 0 ? trimmed : null;
  }

  if (sanitizedName === undefined && sanitizedPlace === undefined) {
    res.status(400).json({ error: 'At least one editable field (name or place) must be provided.' });
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
