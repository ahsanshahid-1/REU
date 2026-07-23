'use strict';

/*
 * Property 10: Confirmation numbers are unique and well-formed
 * (design.md — Correctness Properties).
 *
 *   For any sequence of accepted applications, each SHALL receive a
 *   confirmation number matching the `REU27-` format, all issued confirmation
 *   numbers SHALL be distinct, and the stored application email SHALL equal
 *   the applicant's verified account email.
 *
 * Validates: Requirements 14.6
 *
 * Strategy:
 *  - A single app instance (makeFactoryApp, in-memory SQLite) is seeded with
 *    many DISTINCT verified users plus a live session per user, written
 *    directly into app.locals.db. Because the applications table enforces one
 *    row per user_id, each seeded user can submit exactly once — so driving one
 *    submission per user yields a genuine SEQUENCE of accepted applications.
 *  - A fast-check async property drives >= 100 distinct submissions (one per
 *    user, selected via a monotonic counter so no user is reused). Each run
 *    varies the form field values, and — critically — injects a bogus `email`
 *    form field to prove the stored email is taken from the verified account,
 *    never from request input.
 *  - Invariants checked per accepted submission and in aggregate:
 *      * confirmation matches /^REU27-/
 *      * all confirmations are distinct (tracked in a Set)
 *      * applications.email for that row === the seeded account email
 *        (and NOT the bogus form-field email)
 *  - A final assertion confirms at least 100 accepted submissions were
 *    collected, so the "sequence" is non-trivial.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const request = require('supertest');
const crypto = require('node:crypto');

const { makeFactoryApp } = require('./helpers');

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');
const NUM_RUNS = 100;
// Seed a comfortable surplus over NUM_RUNS so every property run (including any
// shrink replays) can claim a fresh, never-before-submitted user.
const SEEDED_USERS = NUM_RUNS + 40;

// Deterministically classify affiliation the way the app does (by email domain)
// so the CHECK constraint on users.affiliation is satisfied.
function affiliationFor(email) {
  return /@(.+\.)?ualr\.edu$/i.test(email) ? 'ualr' : 'external';
}

// Seed `count` verified users, each with an active session, directly in the DB.
// Returns an array of { email, token } in insertion order.
function seedVerifiedUsers(db, count) {
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, name, affiliation, verified, verify_code, created_at)
     VALUES (?,?,?,?,1,NULL,?)`,
  );
  const insertSession = db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)',
  );
  const farFuture = new Date(Date.now() + 30 * 864e5).toISOString();
  const now = new Date().toISOString();
  const users = [];

  const seed = db.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      // Distinct emails; mix internal/external domains to exercise both.
      const domain = i % 5 === 0 ? 'ualr.edu' : `school${i}.edu`;
      const email = `applicant${i}@${domain}`;
      const info = insertUser.run(
        email,
        'x'.repeat(60), // opaque non-empty hash; login is not exercised here
        `Applicant ${i}`,
        affiliationFor(email),
        now,
      );
      const token = crypto.randomBytes(32).toString('hex');
      insertSession.run(token, info.lastInsertRowid, farFuture);
      users.push({ email, token });
    }
  });
  seed();
  return users;
}

// Generators for valid, varied form field values (all pass the field oracle).
const validText = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);
const validEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,12}$/),
    fc.stringMatching(/^[a-z0-9]{1,12}$/),
    fc.constantFrom('com', 'edu', 'org'),
  )
  .map(([l, h, tld]) => `${l}@${h}.${tld}`);

const formArb = fc.record({
  first_name: validText,
  last_name: validText,
  institution: validText,
  major: validText,
  ref1_name: validText,
  ref2_name: validText,
  ref1_email: validEmail,
  ref2_email: validEmail,
  institution_type: fc.constantFrom('community_college', 'university', 'college'),
  year: fc.constantFrom('freshman', 'sophomore', 'junior', 'senior'),
  theme1: fc.constantFrom('ai', 'security', 'data'),
  citizenship: fc.constantFrom('us_citizen', 'us_national', 'permanent_resident'),
  statementLen: fc.integer({ min: 1200, max: 1400 }),
});

test('Feature: reu-recruitment-site, Property 10: Confirmation numbers are unique and well-formed', async () => {
  const ctx = makeFactoryApp();
  try {
    const users = seedVerifiedUsers(ctx.db, SEEDED_USERS);

    const confirmations = new Set();
    let accepted = 0;
    let cursor = 0; // monotonic index into `users`; guarantees no user reuse

    await fc.assert(
      fc.asyncProperty(formArb, async (form) => {
        assert.ok(cursor < users.length, 'ran out of seeded users');
        const user = users[cursor];
        cursor += 1;

        const req = request(ctx.app)
          .post('/api/applications')
          .set('Cookie', `session=${user.token}`);

        const fields = {
          first_name: form.first_name,
          last_name: form.last_name,
          institution: form.institution,
          institution_type: form.institution_type,
          major: form.major,
          year: form.year,
          theme1: form.theme1,
          ref1_name: form.ref1_name,
          ref1_email: form.ref1_email,
          ref2_name: form.ref2_name,
          ref2_email: form.ref2_email,
          citizenship: form.citizenship,
          statement: 'a'.repeat(form.statementLen),
          // Bogus email in the form body: the stored email MUST ignore this and
          // use the verified account email instead.
          email: 'attacker@evil.example',
        };
        for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
        req.attach('transcript', PDF_BYTES, { filename: 't.pdf', contentType: 'application/pdf' });

        const res = await req;
        assert.equal(res.status, 201, `submission should be accepted, got ${res.status} ${JSON.stringify(res.body)}`);

        const confirmation = res.body.confirmation;
        // Well-formed: matches the REU27- format.
        assert.match(confirmation, /^REU27-/, `confirmation should match REU27- format: ${confirmation}`);

        // Distinct across the whole sequence.
        assert.ok(!confirmations.has(confirmation), `duplicate confirmation issued: ${confirmation}`);
        confirmations.add(confirmation);

        // Stored application email equals the verified ACCOUNT email, not the
        // bogus form-field email.
        const row = ctx.db
          .prepare('SELECT email, confirmation FROM applications WHERE confirmation = ?')
          .get(confirmation);
        assert.ok(row, `stored application row should exist for ${confirmation}`);
        assert.equal(row.email, user.email, 'stored email must equal the verified account email');
        assert.notEqual(row.email, 'attacker@evil.example', 'stored email must not come from the form field');

        accepted += 1;
      }),
      { numRuns: NUM_RUNS },
    );

    // The sequence must be non-trivial and every issued number distinct.
    assert.ok(accepted >= 100, `expected >= 100 accepted submissions, got ${accepted}`);
    assert.equal(confirmations.size, accepted, 'every issued confirmation number must be distinct');
  } finally {
    ctx.cleanup();
  }
});
