'use strict';

/*
 * Property 9: One application per cycle (design.md — Correctness Properties).
 *
 *   For any account that already has an application for the current cycle, a
 *   further submission SHALL be rejected and the number of applications
 *   associated with that account SHALL remain one.
 *
 * Validates: Requirements 14.7
 *
 * Strategy:
 *  - Driven end-to-end through POST /api/applications with supertest so the
 *    real one-per-cycle guard (the `applications.user_id UNIQUE` constraint plus
 *    the endpoint's pre-check) is exercised, not a re-implementation.
 *  - Each iteration provisions a DISTINCT verified applicant by seeding a user
 *    row (verified = 1) and a session row directly in `app.locals.db`, then
 *    presenting the session token as the `session` cookie. Seeding bypasses the
 *    deliberately slow bcrypt registration path so the property can run the
 *    required >= 100 iterations quickly, while still driving the genuine
 *    submission endpoint.
 *  - Field values vary per iteration (names, institution, major, year, theme,
 *    references, citizenship, statement length) to explore many valid inputs;
 *    every generated body is a VALID application, so the first submission must
 *    succeed (201 + REU27- confirmation) and the second must be rejected (409)
 *    with the applications count for that user_id staying exactly one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');
const { CITIZENSHIP, EMAIL_RE, clean } = require('../lib/core');

// A minimal but well-formed PDF payload accepted by the multer PDF/size gate.
const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');

// ---- generators -----------------------------------------------------------

// Non-empty-after-trim required text (survives clean()).
const validText = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => clean(s).length > 0);

// A reference email that matches the server's EMAIL_RE after clean().
const validEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9._%+-]{1,15}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
    fc.constantFrom('com', 'edu', 'org', 'net', 'io'),
  )
  .map(([local, host, tld]) => `${local}@${host}.${tld}`)
  .filter((e) => EMAIL_RE.test(clean(e)));

// Personal statement >= 1200 chars (~300 words), the endpoint's threshold.
const validStatement = fc.integer({ min: 1200, max: 1400 }).map((n) => 'a'.repeat(n));

// A complete, VALID application body (every required field present and valid).
const validApplicationArb = fc.record({
  first_name: validText,
  last_name: validText,
  institution: validText,
  institution_type: fc.constantFrom('community_college', 'university', 'four_year', 'other'),
  major: validText,
  year: fc.constantFrom('freshman', 'sophomore', 'junior', 'senior'),
  theme1: fc.constantFrom('ai', 'cyber', 'data', 'systems'),
  ref1_name: validText,
  ref2_name: validText,
  ref1_email: validEmail,
  ref2_email: validEmail,
  citizenship: fc.constantFrom(...CITIZENSHIP),
  statement: validStatement,
});

// ---- direct seeding (bypasses bcrypt) -------------------------------------

let userCounter = 0;

// Insert a verified user + an active session directly, returning the session
// token to present as the `session` cookie. No bcrypt, no register round-trip.
function seedVerifiedUserWithSession(db) {
  const email = `applicant.u${userCounter++}@example.com`;
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, affiliation, verified, verify_code, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(email, 'x', 'Seeded Applicant', 'external', 1, null, new Date().toISOString());
  const userId = info.lastInsertRowid;

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .run(token, userId, expires);

  return { userId, token };
}

// Submit an application for a seeded session as multipart with a PDF transcript.
function submitApplication(app, token, body) {
  const req = request(app)
    .post('/api/applications')
    .set('Cookie', `session=${token}`);
  for (const [k, v] of Object.entries(body)) req.field(k, String(v));
  req.attach('transcript', PDF_BYTES, { filename: 'transcript.pdf', contentType: 'application/pdf' });
  return req;
}

// ---------------------------------------------------------------------------

test('Feature: reu-recruitment-site, Property 9: One application per cycle', async () => {
  const ctx = makeFactoryApp();
  const countFor = ctx.db.prepare('SELECT COUNT(*) AS c FROM applications WHERE user_id = ?');

  try {
    await fc.assert(
      fc.asyncProperty(validApplicationArb, async (body) => {
        // A fresh, distinct verified applicant for this iteration.
        const { userId, token } = seedVerifiedUserWithSession(ctx.db);

        // First submission: a complete valid application is accepted.
        const first = await submitApplication(ctx.app, token, body);
        assert.equal(
          first.status,
          201,
          `first submission should be accepted, got ${first.status} ${JSON.stringify(first.body)}`,
        );
        assert.match(first.body.confirmation, /^REU27-/, 'confirmation must use the REU27- format');
        assert.equal(countFor.get(userId).c, 1, 'exactly one application should exist after the first submission');

        // Second submission for the SAME account: rejected as one-per-cycle.
        const second = await submitApplication(ctx.app, token, body);
        assert.equal(
          second.status,
          409,
          `second submission should be rejected with 409, got ${second.status} ${JSON.stringify(second.body)}`,
        );
        assert.match(second.body.error, /already submitted an application this cycle/i, 'rejection should explain one-application-per-cycle');

        // The count associated with the account stays exactly one.
        assert.equal(countFor.get(userId).c, 1, 'the applications count for the account must remain exactly one');
      }),
      { numRuns: 100 },
    );
  } finally {
    ctx.cleanup();
  }
});
