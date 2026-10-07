import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { getAuthConfig, isAuthConfigured } from '../auth/config.js';
import { signAuthToken } from '../auth/jwt.js';
import { findOrCreateGoogleUser, getUserById, updateUserProfile } from '../db/users.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const OAUTH_STATE_COOKIE = 'oauth_state';
const AUTH_TOKEN_COOKIE = 'travelgenie_auth';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const AUTH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Constant-time string comparison to safely prevent timing attacks on OAuth state tokens.
 */
function safeStateCompare(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * GET /api/auth/google
 * Initiates the Google OAuth 2.0 flow with state CSRF protection.
 */
router.get('/google', (_req: Request, res: Response): void => {
  try {
    if (!isAuthConfigured()) {
      console.error('[OAuth Error] Google OAuth environment configuration is incomplete.');
      res.status(503).send('Authentication service is not configured.');
      return;
    }

    const config = getAuthConfig();
    const oauth2Client = new OAuth2Client(
      config.googleClientId,
      config.googleClientSecret,
      config.googleCallbackUrl
    );

    // Generate cryptographically secure random state value for CSRF mitigation
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in a short-lived httpOnly cookie
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE_MS
    });

    // Request standard OpenID Connect profile scopes
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state
    });

    // Strictly redirect to Google authorization URL (no arbitrary redirect parameter accepted)
    res.redirect(authUrl);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown initialization error';
    console.error('[OAuth Initiate Error]:', errorMsg);
    res.status(500).send('Authentication failed');
  }
});

/**
 * GET /api/auth/google/callback
 * Exchanges authorization code, verifies Google identity, syncs user in PostgreSQL,
 * and sets application JWT session cookie.
 */
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  // Extract and validate query parameters
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const cookieState = typeof req.cookies?.[OAUTH_STATE_COOKIE] === 'string'
    ? req.cookies[OAUTH_STATE_COOKIE]
    : null;

  // Clear the OAuth state cookie immediately so it cannot be reused in replay attempts
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });

  // Verify presence and validity of OAuth state
  if (!code || !state || !cookieState || !safeStateCompare(state, cookieState)) {
    console.warn('[OAuth Callback Warning] State mismatch or missing parameters during callback verification.');
    res.status(400).send('Authentication failed');
    return;
  }

  try {
    if (!isAuthConfigured()) {
      console.error('[OAuth Callback Error] Google OAuth configuration is missing.');
      res.status(503).send('Authentication service is not configured.');
      return;
    }

    const config = getAuthConfig();
    const oauth2Client = new OAuth2Client(
      config.googleClientId,
      config.googleClientSecret,
      config.googleCallbackUrl
    );

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.id_token) {
      console.error('[OAuth Callback Error] Missing id_token in Google token exchange response.');
      res.status(401).send('Authentication failed');
      return;
    }

    // Cryptographically verify Google ID token
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.googleClientId
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
      console.error('[OAuth Callback Error] Google token payload missing required verified identity fields.');
      res.status(401).send('Authentication failed');
      return;
    }

    // Extract verified Google identity information
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || null;
    const profilePicture = payload.picture || null;

    // Persist or retrieve user in PostgreSQL
    const user = await findOrCreateGoogleUser({
      googleId,
      email,
      name,
      profilePicture
    });

    // Issue application-level JWT (containing only minimal user identity, never Google tokens)
    const appToken = signAuthToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      profilePicture: user.profilePicture
    });

    // Set secure application authentication cookie
    res.cookie(AUTH_TOKEN_COOKIE, appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_TOKEN_MAX_AGE_MS
    });

    // Redirect to home root (fixed destination, no user-supplied redirection)
    res.redirect('/');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown callback error';
    console.error('[OAuth Callback Error]:', errorMsg);
    res.status(500).send('Authentication failed');
  }
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile if a valid session cookie exists.
 * Rejects unauthenticated requests with HTTP 401 via requireAuth middleware.
 * Never exposes JWT, secrets, Google tokens, or credentials.
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
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        place: user.place
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown database error';
    console.error('[Get Profile Error]:', errorMsg);
    res.status(500).json({
      authenticated: false,
      error: 'An unexpected internal error occurred.'
    });
  }
});

/**
 * POST /api/auth/logout
 * Clears the travelgenie_auth cookie using identical cookie parameters.
 * Safe to call even if the user is already logged out or has no cookie.
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
 * Allows the authenticated user to update their name and/or place.
 * Requires requireAuth middleware.
 * User ID comes strictly from req.user.userId.
 */
router.patch('/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.user.userId) {
    res.status(401).json({ authenticated: false });
    return;
  }

  // 1. Validate request body is an object
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a valid JSON object.' });
    return;
  }

  // 2. Reject attempts to modify unauthorized/sensitive fields
  const DISALLOWED_FIELDS = [
    'id',
    'google_id',
    'googleId',
    'email',
    'profile_picture',
    'profilePicture',
    'created_at',
    'createdAt',
    'updated_at',
    'updatedAt'
  ];
  for (const field of DISALLOWED_FIELDS) {
    if (field in req.body) {
      res.status(400).json({ error: `Field '${field}' cannot be modified.` });
      return;
    }
  }

  // 3. Validate name field if provided
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

  // 4. Validate place field if provided
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

  // 5. Ensure at least one updatable field is provided
  if (sanitizedName === undefined && sanitizedPlace === undefined) {
    res.status(400).json({ error: 'At least one field (name or place) must be provided.' });
    return;
  }

  // 6. Execute update in database using authenticated user ID only
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
        name: updatedUser.name,
        email: updatedUser.email,
        profilePicture: updatedUser.profilePicture,
        place: updatedUser.place
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown database error';
    console.error('[Update Profile Route Error]:', errorMsg);
    res.status(500).json({
      authenticated: false,
      error: 'Failed to update profile. Please try again later.'
    });
  }
});

export default router;
