'use strict';

/*
 * Feature: reu-recruitment-site, Property 6: Session validity tracks expiry, and logout invalidates
 *
 * Property 6 (design.md):
 *   For any session, a request SHALL resolve to the owning user if and only if
 *   the session exists and its expiration time is in the future; for any active
 *   session, logging out SHALL delete it so that any subsequent lookup of that
 *   token resolves to no user.
 *
 * Validates: Requirements 12.4, 12.6
 *
 * We drive the real session-lookup path through GET /api/auth/me (200 when the
 * cookie resolves to a user, 401 otherwise) and POST /api/auth/logout, and we
 * manipulate sessions.expires_at directly via app.locals.db to place a session
 * clearly in the past or the future.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');

// A window comfortably larger than the time between inserting a session row and
// the subsequent HTTP request, so "past" is unambiguously expired and "future"
// is unambiguously valid (avoids a flaky ~0ms boundary).
const ONE_MINUTE_MS = 60_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Insert a user directly and return its id + email (bypasses bcrypt for speed). */
function seedUser(db, email) {
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, affiliation, verify_code, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(email, 'x'.repeat(60), 'Test User', 'external', null, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), email };
}

/** Insert a session row for userId with the given absolute expiry (Date). */
function seedSession(db, userId, expiresAt) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .run(token, userId, expiresAt.toISOString());
  return token;
}

test(
  'Feature: reu-recruitment-site, Property 6: Session validity tracks expiry, and logout invalidates',
  async () => {
    const ctx = makeFactoryApp();
    const { app, db } = ctx;
    try {
      const user = seedUser(db, 'session-owner@example.com');

      await fc.assert(
        fc.asyncProperty(
          fc.boolean(), // inFuture: whether the session's expiry is ahead of now
          fc.integer({ min: ONE_MINUTE_MS, max: THIRTY_DAYS_MS }), // offset magnitude
          async (inFuture, offsetMs) => {
            // ---- Clause 1: a request resolves to the owning user iff the
            // session exists and its expiry is in the future. ----
            const expiresAt = new Date(Date.now() + (inFuture ? offsetMs : -offsetMs));
            const token = seedSession(db, user.id, expiresAt);

            const meRes = await request(app)
              .get('/api/auth/me')
              .set('Cookie', [`session=${token}`]);

            if (inFuture) {
              assert.equal(meRes.status, 200, 'future-dated session should resolve');
              assert.equal(
                meRes.body.email,
                user.email,
                'the request must resolve to the owning user',
              );
            } else {
              assert.equal(meRes.status, 401, 'expired session must not resolve');
            }

            // A token that does not exist at all must also resolve to no user.
            const ghost = crypto.randomBytes(32).toString('hex');
            const ghostRes = await request(app)
              .get('/api/auth/me')
              .set('Cookie', [`session=${ghost}`]);
            assert.equal(ghostRes.status, 401, 'nonexistent session must not resolve');

            // ---- Clause 2: logout deletes an active session so subsequent
            // lookups of that token resolve to no user. ----
            const liveExpiry = new Date(Date.now() + THIRTY_DAYS_MS);
            const liveToken = seedSession(db, user.id, liveExpiry);

            // Sanity: the live session resolves before logout.
            const before = await request(app)
              .get('/api/auth/me')
              .set('Cookie', [`session=${liveToken}`]);
            assert.equal(before.status, 200, 'active session should resolve before logout');

            const logoutRes = await request(app)
              .post('/api/auth/logout')
              .set('Cookie', [`session=${liveToken}`]);
            assert.equal(logoutRes.status, 200, 'logout should succeed');

            // The session row is gone from storage.
            const row = db
              .prepare('SELECT token FROM sessions WHERE token = ?')
              .get(liveToken);
            assert.equal(row, undefined, 'logout must delete the session row');

            // And a subsequent lookup of that token resolves to no user.
            const after = await request(app)
              .get('/api/auth/me')
              .set('Cookie', [`session=${liveToken}`]);
            assert.equal(after.status, 401, 'logged-out token must not resolve');
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      ctx.cleanup();
    }
  },
);
