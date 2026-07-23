'use strict';

/*
 * Property 3: Verification succeeds only on an exact code match.
 *
 * Feature: reu-recruitment-site, Property 3: Verification succeeds only on an exact code match
 *
 * Validates: Requirements 11.4, 11.5
 *
 * For any account with stored verification code `c` and any submitted string
 * `s`, the account becomes verified if and only if `s` equals `c`. When
 * `s !== c` the account stays unverified and an "incorrect code" error is
 * returned.
 *
 * Strategy: register a small number of accounts (bcrypt is slow, so we keep
 * this minimal) via the devEcho factory app to obtain each account's real
 * verification code and session cookie. We then run the code-comparison
 * property at >= 100 iterations: each run picks an account, resets its stored
 * state to (unverified, code = c) directly in the users table so the same
 * account can be probed many times, submits a generated string to
 * POST /api/auth/verify, and asserts that verification succeeded iff the
 * submitted string equals the stored code.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');

// A few accounts is enough: the property runs many code comparisons per
// account, and each registration pays the bcrypt cost only once.
const ACCOUNT_COUNT = 3;

test('Property 3: verification succeeds if and only if the submitted string equals the stored code', async () => {
  const ctx = makeFactoryApp({ devEcho: true });
  const { app, db } = ctx;

  try {
    // Register the accounts and capture each one's real verification code
    // (surfaced via devEcho) and session cookie.
    const accounts = [];
    for (let i = 0; i < ACCOUNT_COUNT; i++) {
      const email = `applicant${i}@example.edu`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email, name: `Applicant ${i}`, password: 'a-strong-password' });

      assert.equal(res.status, 201, 'registration should succeed');
      assert.match(String(res.body.devCode), /^\d{6}$/, 'devEcho should surface a six-digit code');

      const cookie = res.headers['set-cookie'];
      assert.ok(cookie, 'registration should start a session');

      const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      accounts.push({ id: row.id, cookie, code: String(res.body.devCode) });
    }

    // Candidate submitted strings. Kept "clean-safe" (no leading/trailing
    // whitespace, length <= 10) so the server's clean(code, 10) normalization
    // does not alter the value, keeping the s === c comparison faithful.
    const cleanSafeString = fc
      .string({ maxLength: 10 })
      .map((s) => s.trim())
      .filter((s) => s.length <= 10);
    const digitString = fc
      .integer({ min: 0, max: 9_999_999 })
      .map((n) => String(n));
    const randomCandidate = fc.oneof(digitString, cleanSafeString);

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: ACCOUNT_COUNT - 1 }),
        fc.boolean(),
        randomCandidate,
        async (idx, useCorrect, rand) => {
          const account = accounts[idx];
          const c = account.code;
          const s = useCorrect ? c : rand;

          // Reset the account to (unverified, code = c) so this account can be
          // probed repeatedly; a prior successful verify clears the code.
          db.prepare('UPDATE users SET verified = 0, verify_code = ? WHERE id = ?')
            .run(c, account.id);

          const res = await request(app)
            .post('/api/auth/verify')
            .set('Cookie', account.cookie)
            .send({ code: s });

          const expected = s === c;
          const after = db.prepare('SELECT verified FROM users WHERE id = ?').get(account.id);

          if (expected) {
            assert.equal(res.status, 200, `exact match should verify (code=${JSON.stringify(s)})`);
            assert.equal(res.body.verified, true, 'response should report verified');
            assert.equal(after.verified, 1, 'account should be marked verified in the store');
          } else {
            assert.equal(res.status, 400, `mismatch should be rejected (code=${JSON.stringify(s)})`);
            assert.match(String(res.body.error), /correct/i, 'error should indicate an incorrect code');
            assert.equal(after.verified, 0, 'account should remain unverified on mismatch');
          }
        },
      ),
      { numRuns: 200 },
    );
  } finally {
    ctx.cleanup();
  }
});
