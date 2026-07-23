'use strict';

/*
 * Applicant-eligibility email gate: account registration requires an
 * educational (.edu) email address.
 *
 * Two layers are covered:
 *   1. the pure `isEduEmail(email)` helper in lib/core.js (unit + property), and
 *   2. the POST /api/auth/register endpoint, which must reject a non-.edu email
 *      with 400 (before creating any account) and accept a .edu email with 201.
 *
 * The endpoint check runs AFTER the generic EMAIL_RE shape check and BEFORE the
 * account is persisted, so a rejected non-.edu registration creates no user row.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');
const { isEduEmail } = require('../lib/core');

// ---- unit: anchor examples -------------------------------------------------

test('isEduEmail: accepts .edu domains (incl. UALR + institutional subdomains)', () => {
  for (const e of [
    'a@ualr.edu',
    'a@trojans.ualr.edu',
    'a@cs.university.edu',
    'student@example.edu',
    'MixedCase@Example.EDU',
  ]) {
    assert.equal(isEduEmail(e), true, `${e} should be accepted`);
  }
});

test('isEduEmail: rejects non-.edu domains and malformed input', () => {
  for (const e of [
    'a@gmail.com',
    'a@example.org',
    'a@school.edu.evil.com', // .edu is not the final label
    'a@edu',                 // no dot before edu
    'a@museum',
    'noatsign',
    '',
    undefined,
    null,
  ]) {
    assert.equal(isEduEmail(e), false, `${JSON.stringify(e)} should be rejected`);
  }
});

// ---- property: domain's final label decides membership ---------------------

test('Feature: reu-recruitment-site — isEduEmail is true iff the domain ends with .edu', () => {
  const localArb = fc.stringMatching(/^[a-z0-9._%+-]{1,15}$/);
  const labelArb = fc.stringMatching(/^[a-z0-9]{1,12}$/);
  const tldArb = fc.constantFrom('edu', 'com', 'org', 'net', 'gov', 'edu.au');
  fc.assert(
    fc.property(localArb, fc.array(labelArb, { minLength: 1, maxLength: 3 }), tldArb, (local, labels, tld) => {
      const domain = labels.join('.') + '.' + tld;
      const email = `${local}@${domain}`;
      // Oracle: educational iff the domain's LAST dot-label is exactly "edu".
      const expected = domain.toLowerCase().split('.').pop() === 'edu';
      assert.equal(isEduEmail(email), expected);
    }),
    { numRuns: 200 },
  );
});

// ---- endpoint: register enforces the gate ----------------------------------

test('POST /api/auth/register rejects a non-.edu email with 400 and creates no account', async () => {
  const ctx = makeFactoryApp({ devEcho: true });
  try {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'applicant@gmail.com', name: 'Nope Nope', password: 'a-strong-password' });

    assert.equal(res.status, 400, 'non-.edu registration should be rejected');
    assert.match(res.body.error, /\.edu/i, 'error should mention the .edu requirement');

    const row = ctx.db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get('applicant@gmail.com');
    assert.equal(row.c, 0, 'no account should be created for a rejected email');
  } finally {
    ctx.cleanup();
  }
});

test('POST /api/auth/register accepts a .edu email with 201', async () => {
  const ctx = makeFactoryApp({ devEcho: true });
  try {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'applicant@some-college.edu', name: 'Yes Please', password: 'a-strong-password' });

    assert.equal(res.status, 201, `.edu registration should succeed, got ${res.status}`);
    assert.equal(res.body.email, 'applicant@some-college.edu');
    assert.equal(res.body.affiliation, 'external', 'a non-UALR .edu is external');
  } finally {
    ctx.cleanup();
  }
});
