'use strict';

/*
 * Property 5: Login succeeds only on a correct password.
 *
 * Feature: reu-recruitment-site, Property 5: Login succeeds only on a correct password
 *
 * Validates: Requirements 12.1, 12.2
 *
 * For any existing account and any submitted password, POST /api/auth/login
 * SHALL start an authenticated session (200 + `session` cookie) if and only if
 * the submitted password exactly matches the stored bcrypt hash; otherwise the
 * login SHALL be rejected with 401 and the uniform "email or password is
 * incorrect" error, and no session cookie SHALL be issued.
 *
 * bcrypt runs at cost 12, so a small fixed set of accounts is registered once
 * up front (paying the hashing cost a handful of times) and the property then
 * drives many login attempts across those accounts to reach >= 100 iterations
 * without re-registering per run.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');

const UNIFORM_ERROR = /email or password is incorrect/i;

/** Extract Set-Cookie entries that start a `session` cookie with a value. */
function sessionCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.filter((c) => /^session=[^;]+/.test(c) && !/^session=;/.test(c));
}

test(
  'Feature: reu-recruitment-site, Property 5: Login succeeds only on a correct password',
  async () => {
    const ctx = makeFactoryApp();

    // A small fixed roster of accounts, registered once (cost-12 hashing paid
    // here, not per property run). Passwords are >= 10 chars (registration
    // requirement) and pairwise distinct.
    const accounts = [
      { email: 'ada@external.edu', password: 'correct-horse-battery' },
      { email: 'grace@trojans.ualr.edu', password: 'staple-42-tango-9' },
      { email: 'linus@example.edu', password: 'passphrase-omega-7' },
    ];

    try {
      for (const acct of accounts) {
        const res = await request(ctx.app)
          .post('/api/auth/register')
          .send({ email: acct.email, name: 'Test User', password: acct.password });
        assert.equal(res.status, 201, `setup: registering ${acct.email} should succeed`);
      }

      await fc.assert(
        fc.asyncProperty(
          fc.nat({ max: accounts.length - 1 }),
          fc.boolean(),
          fc.string(),
          async (idx, useCorrect, wrongCandidate) => {
            const acct = accounts[idx];
            const submitted = useCorrect ? acct.password : wrongCandidate;

            // Oracle: success is defined purely by exact match to the stored
            // password, independent of how the candidate was generated (a
            // randomly generated wrong candidate could, in theory, collide
            // with the real password).
            const expectSuccess = submitted === acct.password;

            const res = await request(ctx.app)
              .post('/api/auth/login')
              .send({ email: acct.email, password: submitted });

            const cookies = sessionCookies(res);

            if (expectSuccess) {
              assert.equal(res.status, 200, 'correct password should log in');
              assert.equal(res.body.email, acct.email);
              assert.ok(
                cookies.length > 0,
                'a session cookie should be set on successful login',
              );
            } else {
              assert.equal(res.status, 401, 'wrong password should be rejected');
              assert.match(String(res.body.error || ''), UNIFORM_ERROR);
              assert.equal(
                cookies.length,
                0,
                'no session cookie should be set on failed login',
              );
            }
          },
        ),
        { numRuns: 150 },
      );
    } finally {
      ctx.cleanup();
    }
  },
);
