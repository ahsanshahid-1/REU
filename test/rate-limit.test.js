'use strict';

/*
 * Abuse / bot / DDoS hardening: app-level rate limiting on the sensitive write
 * endpoints (account register/verify/login/resend and application submission).
 *
 * This is a second layer behind the edge WAF/reverse-proxy that fronts the CRC
 * deployment (see DEPLOY.md). The limiter is OFF in the test environment by
 * default so the property suite is not throttled; these tests build isolated
 * instances with the limiter explicitly ENABLED and configured with small caps.
 *
 * Coverage:
 *   - per-IP cap on the auth cluster (registration flooding),
 *   - per-email cap on the auth cluster (targeted credential/code guessing),
 *   - per-user/IP cap on application submission, and
 *   - the default OFF behavior (no throttling in dev/test).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { makeFactoryApp } = require('./helpers');

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');

function validFormFields() {
  return {
    first_name: 'Ada', last_name: 'Lovelace', institution: 'Example College',
    institution_type: 'community_college', major: 'Computer Science', year: 'sophomore',
    theme1: 'ai', ref1_name: 'Grace Hopper', ref1_email: 'grace@example.edu',
    ref2_name: 'Alan Turing', ref2_email: 'alan@example.edu',
    citizenship: 'us_citizen', statement: 'a'.repeat(1300),
  };
}

test('rate limit: per-IP cap on registration returns 429 once exceeded', async () => {
  // Cap the IP at 3 auth hits; keep the per-email cap high so the IP cap is
  // what trips (each registration uses a distinct email).
  const ctx = makeFactoryApp({
    devEcho: true,
    rateLimit: { enabled: true, auth: { max: 3, emailMax: 50, windowMs: 60000 } },
  });
  try {
    assert.equal(ctx.app.locals.rateLimitEnabled, true, 'limiter should be enabled for this instance');
    const agent = request(ctx.app);
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await agent
        .post('/api/auth/register')
        .send({ email: `flood${i}@example.edu`, name: 'Flood Bot', password: 'a-strong-password' });
      statuses.push(res.status);
    }
    // First three within the cap succeed; the fourth+ are rejected with 429.
    assert.deepEqual(statuses.slice(0, 3), [201, 201, 201], `first three should pass, got ${statuses}`);
    assert.ok(statuses.slice(3).every((s) => s === 429), `requests past the cap should be 429, got ${statuses}`);
  } finally {
    ctx.cleanup();
  }
});

test('rate limit: per-email cap on the auth cluster returns 429 (targeted attempts)', async () => {
  // High IP cap, low per-email cap: repeated attempts against the SAME email
  // (e.g. password/code guessing) are throttled even from within the IP cap.
  const ctx = makeFactoryApp({
    rateLimit: { enabled: true, auth: { max: 100, emailMax: 2, windowMs: 60000 } },
  });
  try {
    const agent = request(ctx.app);
    const target = 'victim@example.edu';
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await agent.post('/api/auth/login').send({ email: target, password: 'wrong-password' });
      statuses.push(res.status);
    }
    // Bad credentials -> 401 while under the email cap; 429 once over it.
    assert.deepEqual(statuses.slice(0, 2), [401, 401], `first two should be 401, got ${statuses}`);
    assert.ok(statuses.slice(2).every((s) => s === 429), `attempts past the email cap should be 429, got ${statuses}`);
  } finally {
    ctx.cleanup();
  }
});

test('rate limit: application submission is capped per user/IP', async () => {
  const ctx = makeFactoryApp({
    rateLimit: { enabled: true, apply: { max: 1, windowMs: 60000 } },
  });
  try {
    // Create a verified account so the submission reaches the apply limiter.
    const agent = request.agent(ctx.app);
    const email = 'applicant@example.edu';
    const reg = await agent
      .post('/api/auth/register')
      .send({ email, name: 'Ada Applicant', password: 'a-strong-password' });
    assert.equal(reg.status, 201);
    ctx.db.prepare('UPDATE users SET verified = 1, verify_code = NULL WHERE email = ?').run(email);

    const submit = () => {
      const req = agent.post('/api/applications');
      for (const [k, v] of Object.entries(validFormFields())) req.field(k, v);
      return req.attach('transcript', PDF_BYTES, { filename: 't.pdf', contentType: 'application/pdf' });
    };

    const first = await submit();
    assert.equal(first.status, 201, `first submission should be accepted, got ${first.status}`);

    // The apply limiter runs before the one-per-cycle check, so the second
    // submission is rejected as rate-limited (429), not as a duplicate (409).
    const second = await submit();
    assert.equal(second.status, 429, `second submission should be rate-limited, got ${second.status}`);
  } finally {
    ctx.cleanup();
  }
});

test('rate limit: disabled by default in the test environment (no throttling)', async () => {
  const ctx = makeFactoryApp({ devEcho: true });
  try {
    assert.equal(ctx.app.locals.rateLimitEnabled, false, 'limiter should be OFF by default in tests');
    const agent = request(ctx.app);
    for (let i = 0; i < 6; i++) {
      const res = await agent
        .post('/api/auth/register')
        .send({ email: `nolimit${i}@example.edu`, name: 'No Limit', password: 'a-strong-password' });
      assert.notEqual(res.status, 429, `request ${i} should not be throttled when the limiter is off`);
    }
  } finally {
    ctx.cleanup();
  }
});
