'use strict';

/*
 * Feature: reu-recruitment-site — Account-flow example/integration tests (Task 3.7)
 *
 * These are worked-example / integration tests (not property tests) that walk
 * the full applicant account happy path end to end against a real app instance
 * (in-memory SQLite via makeFactoryApp), driven with supertest:
 *
 *   register -> verify -> logout -> login -> GET /api/auth/me
 *
 * and they lock in the session-cookie security attributes:
 *   - the session cookie is always HttpOnly (Req 12.5), and
 *   - the `Secure` attribute is set when NODE_ENV === 'production' (Req 12.5).
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.3, 12.5
 *
 * server.js's createSession sets `secure: process.env.NODE_ENV === 'production'`
 * at cookie-set time, so the production case is exercised by flipping
 * process.env.NODE_ENV to 'production' around a registration and restoring it
 * afterwards.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { makeFactoryApp } = require('./helpers');

/** Pull the Set-Cookie entry for the `session` cookie from a response. */
function sessionSetCookie(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.find((c) => c.startsWith('session='));
}

test(
  'Feature: reu-recruitment-site — account happy path: register -> verify -> login -> me',
  async () => {
    // devEcho:true so the six-digit verification code is surfaced in the
    // registration response (Req 11.3) for the test to complete verification.
    const ctx = makeFactoryApp({ devEcho: true });
    const { app } = ctx;
    // An agent persists the session cookie across requests, exercising the real
    // authenticated-session flow rather than manually replaying cookies.
    const agent = request.agent(app);

    try {
      const email = 'applicant@example.edu';
      const password = 'a-strong-password'; // >= 10 chars (Req 11.1)

      // ---- Register (Req 11.1, 11.3): 201, account created, session started,
      // affiliation derived, dev verification code present. ----
      const reg = await agent
        .post('/api/auth/register')
        .send({ email, name: 'Ada Applicant', password });

      assert.equal(reg.status, 201, 'registration should succeed with 201');
      assert.equal(reg.body.email, email);
      assert.equal(reg.body.affiliation, 'external', 'non-UALR email -> external');
      assert.equal(reg.body.verified, false, 'account is not verified at registration');
      assert.match(
        String(reg.body.devCode),
        /^\d{6}$/,
        'a six-digit verification code should be issued (Req 11.3)',
      );

      // The registration response sets an HttpOnly session cookie (session
      // started per Req 11.1; cookie attributes per Req 12.5).
      const regCookie = sessionSetCookie(reg);
      assert.ok(regCookie, 'registration should set a session cookie');
      assert.match(regCookie, /HttpOnly/i, 'session cookie must be HttpOnly (Req 12.5)');

      const devCode = String(reg.body.devCode);

      // ---- Verify (Req 11.4): submitting the matching code verifies the account. ----
      const verify = await agent.post('/api/auth/verify').send({ code: devCode });
      assert.equal(verify.status, 200, 'verification should succeed');
      assert.equal(verify.body.verified, true, 'account should be verified (Req 11.4)');

      // ---- Logout then login (Req 12.1): credentials that match start a
      // fresh authenticated session. ----
      const logout = await agent.post('/api/auth/logout').send();
      assert.equal(logout.status, 200, 'logout should succeed');

      const login = await agent.post('/api/auth/login').send({ email, password });
      assert.equal(login.status, 200, 'login with correct credentials should succeed (Req 12.1)');
      assert.equal(login.body.email, email);
      assert.equal(login.body.verified, true, 'verified status should persist across login');

      const loginCookie = sessionSetCookie(login);
      assert.ok(loginCookie, 'login should set a session cookie');
      assert.match(loginCookie, /HttpOnly/i, 'session cookie must be HttpOnly (Req 12.5)');

      // ---- GET /api/auth/me (Req 12.3): identifies the current applicant with
      // verification status and application summary (null before applying). ----
      const me = await agent.get('/api/auth/me');
      assert.equal(me.status, 200, '/api/auth/me should resolve for an active session');
      assert.equal(me.body.email, email);
      assert.equal(me.body.affiliation, 'external');
      assert.equal(me.body.verified, true, 'me should report verification status (Req 12.3)');
      assert.equal(
        me.body.application,
        null,
        'application summary should be null before applying (Req 12.3)',
      );
    } finally {
      ctx.cleanup();
    }
  },
);

test(
  'Feature: reu-recruitment-site — session cookie is Secure under production config (Req 12.5)',
  async () => {
    // createSession reads process.env.NODE_ENV at cookie-set time, so flip it to
    // production for this instance and restore afterwards.
    const priorNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const ctx = makeFactoryApp({ devEcho: true });
    const { app } = ctx;
    try {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ email: 'prod-applicant@example.edu', name: 'Pro Duction', password: 'a-strong-password' });

      assert.equal(reg.status, 201, 'registration should succeed under production config');

      const cookie = sessionSetCookie(reg);
      assert.ok(cookie, 'registration should set a session cookie');
      assert.match(cookie, /HttpOnly/i, 'session cookie must be HttpOnly (Req 12.5)');
      assert.match(cookie, /Secure/i, 'session cookie must be Secure in production (Req 12.5)');
    } finally {
      ctx.cleanup();
      // Restore env regardless of assertion outcome.
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = priorNodeEnv;
    }
  },
);
