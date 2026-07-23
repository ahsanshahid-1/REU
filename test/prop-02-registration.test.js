'use strict';

/*
 * Property 2: Registration creates exactly one account with a session, and
 * rejects duplicates (design.md — Correctness Properties).
 *
 *   For any valid registration (well-formed email, non-empty name, password
 *   >= 10 chars), the Account_Service SHALL create exactly one user with
 *   affiliation derived from the email and start an authenticated session;
 *   and for any email already associated with an account, a subsequent
 *   registration with that email SHALL be rejected without creating a second
 *   account.
 *
 * Validates: Requirements 11.1, 11.2
 *
 * Driven end-to-end through POST /api/auth/register with supertest against a
 * throwaway in-memory database (makeFactoryApp). bcrypt cost 12 makes each
 * registration deliberately slow, so a single app instance is shared across
 * all iterations (each iteration registers a distinct email) to keep the run
 * performant while still satisfying the >= 100-iteration requirement.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');
const { affiliationOf } = require('../lib/core');

// ---- generators -----------------------------------------------------------

// Local part: keeps out whitespace and '@' so the result matches the server's
// EMAIL_RE. A monotonic suffix guarantees each generated email is unique across
// iterations, so the shared database never sees an accidental collision.
let counter = 0;
const localPart = fc
  .stringMatching(/^[a-z0-9._-]{1,20}$/)
  .map((s) => `${s}u${counter++}`);

// A spread of domains covering both derived affiliations: exact UALR domains,
// a UALR subdomain (-> 'ualr'), and unrelated domains (-> 'external').
// Accounts require a .edu email (applicant-eligibility gate), so every
// generated domain is educational. The spread still covers both derived
// affiliations: UALR domains/subdomains (-> 'ualr') and other .edu domains
// (-> 'external').
const domain = fc.constantFrom(
  'ualr.edu',
  'trojans.ualr.edu',
  'cs.ualr.edu',
  'example.edu',
  'university.edu',
  'my-school.edu',
);

const validEmail = fc
  .tuple(localPart, domain)
  .map(([local, dom]) => `${local}@${dom}`.toLowerCase());

// Name: at least one non-whitespace character survives trim().
const validName = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0);

// Password: at least 10 characters.
const validPassword = fc.string({ minLength: 10, maxLength: 30 });

// ---------------------------------------------------------------------------

test('Feature: reu-recruitment-site, Property 2: Registration creates exactly one account with a session, and rejects duplicates', async () => {
  const ctx = makeFactoryApp();
  const countFor = ctx.db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?');
  const rowsFor = () => ctx.db.prepare('SELECT * FROM users WHERE email = ?');

  try {
    await fc.assert(
      fc.asyncProperty(validEmail, validName, validPassword, async (email, name, password) => {
        const agent = request(ctx.app);

        // ---- First registration: creates exactly one account + a session ----
        const first = await agent.post('/api/auth/register').send({ email, name, password });

        assert.equal(first.status, 201, `expected 201 on first registration, got ${first.status}`);

        // A session was started: an httpOnly `session` cookie is set.
        const cookies = first.headers['set-cookie'] || [];
        const sessionCookie = cookies.find((c) => c.startsWith('session='));
        assert.ok(sessionCookie, 'a session cookie should be set on registration');
        assert.match(sessionCookie, /HttpOnly/i, 'session cookie must be httpOnly');

        // Affiliation is derived from the email domain.
        assert.equal(first.body.affiliation, affiliationOf(email), 'affiliation must be derived from email');
        assert.equal(first.body.email, email);
        assert.equal(first.body.verified, false);

        // Exactly one user row exists for this email.
        assert.equal(countFor.get(email).c, 1, 'exactly one account should exist after registration');
        const created = rowsFor().get(email);
        assert.equal(created.affiliation, affiliationOf(email), 'stored affiliation must match derivation');

        // ---- Second registration with the same email: rejected as duplicate ----
        const dup = await agent.post('/api/auth/register').send({
          email,
          name: `${name} again`,
          password: `${password}-x2`,
        });

        assert.equal(dup.status, 409, `duplicate registration should be rejected with 409, got ${dup.status}`);

        // Still exactly one account — no second row was created.
        assert.equal(countFor.get(email).c, 1, 'duplicate registration must not create a second account');
      }),
      { numRuns: 100 },
    );
  } finally {
    ctx.cleanup();
  }
});
