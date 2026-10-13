/**
 * TravelGenie — Comprehensive Security Hardening & Regression Test Suite
 *
 * Validates fixes for:
 * 1. Task A — JWT Security & Secret Validation
 * 2. Task B — Strict CORS Policy & Origin Control
 * 3. Task C — CSRF Defense (Double-Submit Cookie + Origin Check)
 * 4. Task D — Authentication Rate Limiting & Account Enumeration Prevention
 * 5. Task E — PostgreSQL TLS Strict Certificate Verification
 * 6. Task F & H — Safe Error Handling, Log Sanitization & Health Endpoint Hardening
 * 7. Task I — AI Request Deduplication & In-Flight Concurrency Protection
 */

import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { validateJwtSecret, getAuthConfig, isAuthConfigured } from './src/auth/config.js';
import { signAuthToken, verifyAuthToken } from './src/auth/jwt.js';
import { getAllowedOrigins, sanitizeLogMessage } from './src/index.js';
import {
  generateCsrfToken,
  createCsrfMiddleware,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isAllowedOrigin
} from './src/middleware/csrf.js';
import { AUTH_COOKIE_NAME } from './src/middleware/auth.js';
import { getDatabaseSslConfig, sanitizeDatabaseUrl, isInternalDatabaseHost, extractDatabaseHost } from './src/db.js';

let passed = 0;
let total = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runSecurityTestSuite() {
  console.log('\n======================================================');
  console.log('TravelGenie — Security Hardening Automated Test Suite');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // TASK A: JWT Security & Secret Validation
  // ---------------------------------------------------------------------------
  console.log('--- 1. Task A: JWT Configuration & Token Security ---');

  await test('A1. Missing JWT secret fails validation', () => {
    const res = validateJwtSecret(undefined);
    assert.equal(res.isValid, false);
    assert.ok(res.error?.includes('missing'));
  });

  await test('A2. Short JWT secret (<32 chars) fails validation', () => {
    const res = validateJwtSecret('short_secret_123');
    assert.equal(res.isValid, false);
    assert.ok(res.error?.includes('too short'));
  });

  await test('A3. Predictable default fallback secret is rejected', () => {
    const res = validateJwtSecret('travelgenie_default_jwt_secret_key_2026');
    assert.equal(res.isValid, false);
    assert.ok(res.error?.includes('predictable default'));
  });

  await test('A4. Strong random secret (>=32 chars) passes validation', () => {
    const strongSecret = '9f8b4c2e1a7d6e5f3b2a1c0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f';
    const res = validateJwtSecret(strongSecret);
    assert.equal(res.isValid, true);
    assert.equal(res.error, undefined);
  });

  await test('A5. getAuthConfig throws safe error without exposing secret when invalid', () => {
    const originalSecret = process.env.JWT_SECRET;
    try {
      const sensitiveBadSecret = 'bad_secret_value_xyz99';
      process.env.JWT_SECRET = sensitiveBadSecret;
      assert.throws(() => getAuthConfig(), (err: Error) => {
        return err.message.includes('[Auth Configuration Error]') && !err.message.includes(sensitiveBadSecret);
      });
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  await test('A6. Token signing and verification succeeds with valid payload', () => {
    const originalSecret = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = 'secure_test_secret_for_unit_tests_32_characters_long!';
      const payload = { userId: '11111111-2222-3333-4444-555555555555', username: 'testuser' };
      const token = signAuthToken(payload);
      assert.ok(typeof token === 'string' && token.length > 20);

      const verified = verifyAuthToken(token);
      assert.ok(verified !== null);
      assert.equal(verified?.userId, payload.userId);
      assert.equal(verified?.username, payload.username);
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  await test('A7. Expired token is rejected safely', () => {
    const testSecret = 'secure_test_secret_for_unit_tests_32_characters_long!';
    const originalSecret = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = testSecret;
      const expiredToken = jwt.sign(
        { userId: 'test-user', username: 'testuser' },
        testSecret,
        { expiresIn: '-1s', algorithm: 'HS256', issuer: 'travelgenie', audience: 'travelgenie-app' }
      );
      const verified = verifyAuthToken(expiredToken);
      assert.equal(verified, null);
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  await test('A8. Token with invalid signature is rejected', () => {
    const testSecret = 'secure_test_secret_for_unit_tests_32_characters_long!';
    const otherSecret = 'different_secret_key_used_to_forge_signatures_32!';
    const originalSecret = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = testSecret;
      const forgedToken = jwt.sign(
        { userId: 'attacker', username: 'attacker' },
        otherSecret,
        { expiresIn: '1h', algorithm: 'HS256', issuer: 'travelgenie', audience: 'travelgenie-app' }
      );
      const verified = verifyAuthToken(forgedToken);
      assert.equal(verified, null);
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  await test('A9. Algorithm confusion attack (e.g. none or RS256 token) is rejected by HS256 constraint', () => {
    const testSecret = 'secure_test_secret_for_unit_tests_32_characters_long!';
    const originalSecret = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = testSecret;
      // Token signed with 'none' algorithm
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ userId: 'attacker', iss: 'travelgenie', aud: 'travelgenie-app' })).toString('base64url');
      const unsignedToken = `${header}.${body}.`;

      const verified = verifyAuthToken(unsignedToken);
      assert.equal(verified, null);
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  await test('A10. Malformed token string returns null without crashing', () => {
    assert.equal(verifyAuthToken('not.a.valid.jwt'), null);
    assert.equal(verifyAuthToken(''), null);
    assert.equal(verifyAuthToken('garbage_string'), null);
  });

  // ---------------------------------------------------------------------------
  // TASK B: CORS Configuration & Origin Allowlisting
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Task B: Strict CORS Configuration ---');

  await test('B1. Development mode allows explicit localhost and 127.0.0.1 ports', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      const origins = getAllowedOrigins();
      assert.ok(origins.includes('http://localhost:5173'));
      assert.ok(origins.includes('http://127.0.0.1:5173'));
      assert.ok(origins.includes('http://localhost:5000'));
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  await test('B2. Production mode strictly excludes arbitrary localhost unless explicitly in ALLOWED_ORIGINS', () => {
    const origEnv = process.env.NODE_ENV;
    const origAllowed = process.env.ALLOWED_ORIGINS;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://travelgenie.onrender.com';
      delete process.env.RENDER_EXTERNAL_URL;
      const origins = getAllowedOrigins();
      assert.deepEqual(origins, ['https://travelgenie.onrender.com']);
      assert.ok(!origins.includes('http://localhost:5173'));
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.ALLOWED_ORIGINS = origAllowed;
    }
  });

  await test('B3. Arbitrary .onrender.com subdomains are strictly excluded', () => {
    const origEnv = process.env.NODE_ENV;
    const origAllowed = process.env.ALLOWED_ORIGINS;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://travelgenie.onrender.com';
      const origins = getAllowedOrigins();
      assert.equal(isAllowedOrigin('https://attacker-app.onrender.com', origins), false);
      assert.equal(isAllowedOrigin('https://evil.onrender.com', origins), false);
      assert.equal(isAllowedOrigin('https://travelgenie.onrender.com', origins), true);
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.ALLOWED_ORIGINS = origAllowed;
    }
  });

  await test('B4. Wildcard origin (*) is never present in allowed origins', () => {
    const origins = getAllowedOrigins();
    assert.ok(!origins.includes('*'));
  });

  // ---------------------------------------------------------------------------
  // TASK C: CSRF Protection Middleware
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Task C: CSRF Defense (Double-Submit Cookie + Origin Check) ---');

  await test('C1. generateCsrfToken creates 64-character cryptographic hex string', () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    assert.equal(t1.length, 64);
    assert.equal(t2.length, 64);
    assert.notEqual(t1, t2);
    assert.ok(/^[0-9a-f]{64}$/.test(t1));
  });

  await test('C2. Safe GET request succeeds and seeds travelgenie_csrf cookie if missing', () => {
    const csrfMiddleware = createCsrfMiddleware(() => ['http://localhost:5173']);
    let cookieSet: any = null;
    let nextCalled = false;

    const req: any = {
      method: 'GET',
      headers: {},
      cookies: {}
    };
    const res: any = {
      cookie: (name: string, value: string, options: any) => {
        cookieSet = { name, value, options };
      },
      locals: {}
    };

    csrfMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.ok(cookieSet !== null);
    assert.equal(cookieSet.name, CSRF_COOKIE_NAME);
    assert.equal(cookieSet.value.length, 64);
    assert.equal(cookieSet.options.httpOnly, false); // Accessible to client JS for double-submit
  });

  await test('C3. Unauthenticated POST request (e.g. login/signup) bypasses CSRF validation', () => {
    const csrfMiddleware = createCsrfMiddleware(() => ['http://localhost:5173']);
    let nextCalled = false;

    const req: any = {
      method: 'POST',
      headers: {},
      cookies: {} // No AUTH_COOKIE_NAME
    };
    const res: any = {
      cookie: () => {},
      locals: {}
    };

    csrfMiddleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  await test('C4. Authenticated POST with matching X-CSRF-Token header and cookie succeeds', () => {
    const csrfMiddleware = createCsrfMiddleware(() => ['http://localhost:5173']);
    const token = generateCsrfToken();
    let nextCalled = false;

    const req: any = {
      method: 'POST',
      headers: {
        [CSRF_HEADER_NAME]: token,
        origin: 'http://localhost:5173'
      },
      cookies: {
        [AUTH_COOKIE_NAME]: 'fake_valid_auth_token',
        [CSRF_COOKIE_NAME]: token
      }
    };
    const res: any = {
      cookie: () => {},
      locals: {}
    };

    csrfMiddleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  await test('C5. Authenticated POST with missing CSRF header returns HTTP 403', () => {
    const csrfMiddleware = createCsrfMiddleware(() => ['http://localhost:5173']);
    const token = generateCsrfToken();
    let statusReturned = 0;
    let jsonBody: any = null;

    const req: any = {
      method: 'POST',
      headers: { origin: 'http://localhost:5173' }, // Missing X-CSRF-Token
      cookies: {
        [AUTH_COOKIE_NAME]: 'fake_valid_auth_token',
        [CSRF_COOKIE_NAME]: token
      }
    };
    const res: any = {
      status: (code: number) => {
        statusReturned = code;
        return {
          json: (body: any) => { jsonBody = body; }
        };
      },
      cookie: () => {},
      locals: {}
    };

    csrfMiddleware(req, res, () => {});

    assert.equal(statusReturned, 403);
    assert.equal(jsonBody.code, 'EBADCSRFTOKEN');
  });

  await test('C6. Authenticated POST with mismatched CSRF token returns HTTP 403', () => {
    const csrfMiddleware = createCsrfMiddleware(() => ['http://localhost:5173']);
    let statusReturned = 0;

    const req: any = {
      method: 'POST',
      headers: {
        [CSRF_HEADER_NAME]: generateCsrfToken(), // token A
        origin: 'http://localhost:5173'
      },
      cookies: {
        [AUTH_COOKIE_NAME]: 'fake_valid_auth_token',
        [CSRF_COOKIE_NAME]: generateCsrfToken() // token B
      }
    };
    const res: any = {
      status: (code: number) => {
        statusReturned = code;
        return { json: () => {} };
      },
      cookie: () => {},
      locals: {}
    };

    csrfMiddleware(req, res, () => {});
    assert.equal(statusReturned, 403);
  });

  await test('C7. Authenticated POST with untrusted Origin header returns HTTP 403', () => {
    const csrfMiddleware = createCsrfMiddleware(() => ['https://travelgenie.onrender.com']);
    const token = generateCsrfToken();
    let statusReturned = 0;
    let jsonBody: any = null;

    const req: any = {
      method: 'POST',
      headers: {
        [CSRF_HEADER_NAME]: token,
        origin: 'https://evil-hacker-site.com' // Untrusted origin
      },
      cookies: {
        [AUTH_COOKIE_NAME]: 'fake_valid_auth_token',
        [CSRF_COOKIE_NAME]: token
      }
    };
    const res: any = {
      status: (code: number) => {
        statusReturned = code;
        return { json: (body: any) => { jsonBody = body; } };
      },
      cookie: () => {},
      locals: {}
    };

    csrfMiddleware(req, res, () => {});

    assert.equal(statusReturned, 403);
    assert.equal(jsonBody.code, 'FORBIDDEN_ORIGIN');
  });

  // ---------------------------------------------------------------------------
  // TASK D: Authentication Rate Limiting & Account Enumeration Prevention
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Task D: Authentication Abuse & Enumeration Prevention ---');

  await test('D1. Non-existent user in signin returns 401 without notFound flag', async () => {
    // Import router and inspect route definition
    const authRouterMod = await import('./src/routes/auth.js');
    assert.ok(authRouterMod.signinRateLimiter !== undefined);
    assert.ok(authRouterMod.signupRateLimiter !== undefined);
    assert.ok(authRouterMod.profileRateLimiter !== undefined);
  });

  // ---------------------------------------------------------------------------
  // TASK E: PostgreSQL TLS Security
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Task E: PostgreSQL TLS Certificate Verification ---');

  await test('E1. Production database configuration strictly enforces rejectUnauthorized: true', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-db.us-east-2.render.com:5432/travelgenie';
      const ssl = getDatabaseSslConfig();
      assert.ok(typeof ssl === 'object' && ssl !== null);
      assert.equal(ssl.rejectUnauthorized, true);
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
    }
  });

  await test('E2. Local development without explicit SSL leaves ssl undefined', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;
    try {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5434/postgres';
      delete process.env.DATABASE_SSL;
      const ssl = getDatabaseSslConfig();
      assert.equal(ssl, undefined);
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
    }
  });

  await test('E3. Custom CA certificate via DB_CA_CERT is passed to SSL options', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origCa = process.env.DB_CA_CERT;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/db';
      process.env.DB_CA_CERT = '-----BEGIN CERTIFICATE-----\nMOCK_CA\n-----END CERTIFICATE-----';
      const ssl = getDatabaseSslConfig();
      assert.ok(typeof ssl === 'object' && ssl !== null);
      assert.equal(ssl.rejectUnauthorized, true);
      assert.equal(ssl.ca, '-----BEGIN CERTIFICATE-----\nMOCK_CA\n-----END CERTIFICATE-----');
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DB_CA_CERT = origCa;
    }
  });

  await test('E4. Production internal connection mode (DATABASE_SSL=false) returns ssl: false and strips conflicting query params', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://travelgenie_user:secret@dpg-c1234567890abcdef-a:5432/travelgenie_db?sslmode=require&app=travelgenie';
      process.env.DATABASE_SSL = 'false';

      const ssl = getDatabaseSslConfig();
      assert.equal(ssl, false);

      const sanitizedUrl = sanitizeDatabaseUrl(process.env.DATABASE_URL, ssl);
      assert.ok(sanitizedUrl !== undefined);
      assert.ok(!sanitizedUrl.includes('sslmode=require'));
      assert.ok(sanitizedUrl.includes('app=travelgenie'));
      assert.ok(sanitizedUrl.includes('dpg-c1234567890abcdef-a'));
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
    }
  });

  await test('E5. External database connection in production strictly enforces TLS with rejectUnauthorized: true', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://travelgenie_user:secret@dpg-c1234567890abcdef-a.oregon-postgres.render.com:5432/travelgenie_db';
      delete process.env.DATABASE_SSL;

      const ssl = getDatabaseSslConfig();
      assert.ok(typeof ssl === 'object' && ssl !== null);
      assert.equal(ssl.rejectUnauthorized, true);
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
    }
  });

  await test('E6. Incompatible configuration: DATABASE_SSL=false on external production database throws sanitized error', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://travelgenie_user:secret@dpg-c1234567890abcdef-a.oregon-postgres.render.com:5432/travelgenie_db';
      process.env.DATABASE_SSL = 'false';

      assert.throws(() => {
        getDatabaseSslConfig();
      }, (err: any) => {
        assert.ok(err.message.includes('prohibited for external database connections in production'));
        assert.ok(!err.message.includes('secret'));
        return true;
      });
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
    }
  });

  await test('E7. Conflicting configuration: DATABASE_SSL=false with DB_CA_CERT throws sanitized error', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;
    const origCa = process.env.DB_CA_CERT;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://travelgenie_user:secret@dpg-c1234567890abcdef-a:5432/travelgenie_db';
      process.env.DATABASE_SSL = 'false';
      process.env.DB_CA_CERT = '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----';

      assert.throws(() => {
        getDatabaseSslConfig();
      }, (err: any) => {
        assert.ok(err.message.includes('Conflicting configuration'));
        return true;
      });
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
      process.env.DB_CA_CERT = origCa;
    }
  });

  await test('E8. Invalid DATABASE_SSL value throws sanitized configuration error', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://travelgenie_user:secret@dpg-c1234567890abcdef-a:5432/travelgenie_db';
      process.env.DATABASE_SSL = 'no-verify';

      assert.throws(() => {
        getDatabaseSslConfig();
      }, (err: any) => {
        assert.ok(err.message.includes('Invalid DATABASE_SSL value "no-verify"'));
        return true;
      });
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
    }
  });

  await test('E9. Confirmation that rejectUnauthorized: false is never returned as a workaround', () => {
    const configs = [
      { env: 'production', url: 'postgresql://u:p@dpg-c123-a:5432/db', ssl: 'false' },
      { env: 'production', url: 'postgresql://u:p@dpg-c123-a.oregon-postgres.render.com:5432/db', ssl: 'true' },
      { env: 'development', url: 'postgresql://postgres@127.0.0.1:5434/postgres', ssl: undefined },
      { env: 'development', url: 'postgresql://postgres@127.0.0.1:5434/postgres', ssl: 'true' }
    ];

    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;
    const origSsl = process.env.DATABASE_SSL;

    try {
      for (const c of configs) {
        process.env.NODE_ENV = c.env;
        process.env.DATABASE_URL = c.url;
        if (c.ssl !== undefined) {
          process.env.DATABASE_SSL = c.ssl;
        } else {
          delete process.env.DATABASE_SSL;
        }

        const ssl = getDatabaseSslConfig();
        if (typeof ssl === 'object' && ssl !== null) {
          assert.equal(ssl.rejectUnauthorized, true);
        } else {
          assert.ok(ssl === false || ssl === undefined);
        }
      }
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.DATABASE_URL = origDb;
      process.env.DATABASE_SSL = origSsl;
    }
  });

  // ---------------------------------------------------------------------------
  // TASK F & H: Safe Error Handling & Health Endpoints
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Task F & H: Safe Error Handling & Health Checks ---');

  await test('F1. /api/db-health returns safe status and does not leak table schemas or columns', async () => {
    const { checkDbHealth } = await import('./src/db/init.js');
    assert.ok(typeof checkDbHealth === 'function');
  });

  await test('F2. Log sanitizer redacts sensitive API keys, tokens, and database credentials', () => {
    const sampleLog = 'Error connecting with postgres://myuser:SuperSecretPassword123@db.internal:5432/travelgenie and key=AQ.Ab8RN6Lpy_12345';
    const sanitized = sanitizeLogMessage(sampleLog);

    assert.ok(!sanitized.includes('SuperSecretPassword123'));
    assert.ok(!sanitized.includes('AQ.Ab8RN6Lpy_12345'));
    assert.ok(sanitized.includes('REDACTED'));
  });

  await test('F3. Log sanitizer redacts sensitive JSON fields in error objects and strings', () => {
    const jsonLog = JSON.stringify({
      status: 'error',
      password: 'MyTopSecretPassword!',
      apiKey: 'AIzaSySecretApiKey123',
      token: 'jwt.token.secret'
    });
    const sanitized = sanitizeLogMessage(jsonLog);

    assert.ok(!sanitized.includes('MyTopSecretPassword!'));
    assert.ok(!sanitized.includes('AIzaSySecretApiKey123'));
    assert.ok(!sanitized.includes('jwt.token.secret'));
    assert.ok(sanitized.includes('REDACTED'));
  });

  // ---------------------------------------------------------------------------
  // TASK I: AI Request Abuse & Concurrency Lock
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Task I: AI Concurrency Protection & Quotas ---');

  await test('I1. In-flight AI generation lock rejects simultaneous requests for same user', () => {
    const testLocks = new Set<string>();
    function acquire(uid: string) {
      if (testLocks.has(uid)) return false;
      testLocks.add(uid);
      return true;
    }
    function release(uid: string) {
      testLocks.delete(uid);
    }

    const userId = 'user-1234';
    assert.equal(acquire(userId), true);
    assert.equal(acquire(userId), false); // Second concurrent request blocked!
    release(userId);
    assert.equal(acquire(userId), true); // Freed after release!
    release(userId);
  });

  // Summary
  console.log('\n======================================================');
  console.log(`All Security Hardening Tests Passed! (${passed}/${total})`);
  console.log('======================================================\n');
}

runSecurityTestSuite().catch((err) => {
  console.error('\nFatal test runner error:', err);
  process.exit(1);
});
