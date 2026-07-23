'use strict';

/*
 * Example / smoke tests for Email_Service configuration and development mode.
 *
 * These are illustrative example tests (not property-based). They pin down the
 * environment-driven behavior of lib/email.js and the app's dev-echo /
 * production surfacing of verification codes:
 *
 *   - Req 13.4: WHERE no mail transport is configured in a development
 *               environment, the System provides a documented development mode
 *               that surfaces verification codes for testing without sending
 *               real email (dev-echo).
 *   - Req 13.5: Email_Service obtains transport credentials and sender
 *               configuration from environment configuration rather than
 *               hard-coded values.
 *   - Req 20.3: The System SHALL NOT expose verification codes in API responses
 *               in any environment consistently.
 *
 * The email module accepts an explicit `env` argument on every public function,
 * so the isTransportConfigured / dev-echo assertions drive it with plain env
 * objects and never mutate process.env. One case exercises the process.env
 * default path directly and restores every key it touches in a finally block
 * (plus a suite-level after() safety net).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const request = require('supertest');

const { makeFactoryApp, purge, paths } = require('./helpers');

// Require the module under test fresh (helpers purge it from the require cache).
purge(paths.EMAIL_PATH);
const email = require('../lib/email');

// ---- process.env safety net -----------------------------------------------
// Snapshot the SMTP/dev keys once so any accidental leak from a test is undone
// even if that test throws before its own finally runs.
const ENV_KEYS = [
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  'MAIL_FROM', 'DEV_ECHO_CODES', 'NODE_ENV',
];
const ENV_SNAPSHOT = {};
for (const k of ENV_KEYS) ENV_SNAPSHOT[k] = process.env[k];

after(() => {
  for (const k of ENV_KEYS) {
    if (ENV_SNAPSHOT[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_SNAPSHOT[k];
  }
});

// ---------------------------------------------------------------------------
// isTransportConfigured — driven purely by SMTP_HOST in the environment.
// Validates: Requirements 13.5
// ---------------------------------------------------------------------------

test('isTransportConfigured() reports false when SMTP_HOST is absent', () => {
  assert.equal(email.isTransportConfigured({}), false, 'empty env => not configured');
  assert.equal(
    email.isTransportConfigured({ SMTP_PORT: '587', MAIL_FROM: 'x@y.z' }),
    false,
    'other SMTP vars without a host => still not configured',
  );
  assert.equal(
    email.isTransportConfigured({ SMTP_HOST: '   ' }),
    false,
    'a blank/whitespace host => not configured',
  );
});

test('isTransportConfigured() reports true when SMTP_HOST is set', () => {
  assert.equal(
    email.isTransportConfigured({ SMTP_HOST: 'smtp.example.edu' }),
    true,
    'a host alone is enough to be configured',
  );
  assert.equal(
    email.isTransportConfigured({
      SMTP_HOST: 'smtp.example.edu',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'secret',
      MAIL_FROM: 'reu@ualr.edu',
    }),
    true,
    'a fully-specified transport env is configured',
  );
});

test('isTransportConfigured() defaults to process.env and reflects it live', () => {
  // Exercise the default (process.env) code path, mutating and restoring the
  // relevant key carefully so no state leaks to other tests.
  const original = process.env.SMTP_HOST;
  try {
    delete process.env.SMTP_HOST;
    assert.equal(email.isTransportConfigured(), false, 'no SMTP_HOST in env => not configured');

    process.env.SMTP_HOST = 'smtp.example.edu';
    assert.equal(email.isTransportConfigured(), true, 'SMTP_HOST in env => configured');
  } finally {
    if (original === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = original;
  }
});

// ---------------------------------------------------------------------------
// Dev-echo mode — no transport configured + DEV_ECHO_CODES=1.
// Validates: Requirements 13.4
// ---------------------------------------------------------------------------

test('dev-echo mode: sendVerificationCode resolves without sending (status "dev-echo")', async () => {
  // No SMTP_HOST => no transport; DEV_ECHO_CODES=1 => dev-echo mode. nodemailer
  // is never required in this path, so no real email leaves the box.
  const result = await email.sendVerificationCode('applicant@example.com', '123456', {
    DEV_ECHO_CODES: '1',
  });
  assert.deepEqual(result, { status: 'dev-echo' }, 'dev-echo mode resolves with the dev-echo status');
});

test('refuse mode: a required send rejects when no transport is configured and dev-echo is off', async () => {
  // Fail-safe: without a transport and without dev-echo, a required send must
  // reject so a caller cannot report success (Req 13.3 companion to 13.4).
  await assert.rejects(
    () => email.sendVerificationCode('applicant@example.com', '123456', {}),
    (err) => {
      assert.equal(err.code, 'EMAIL_NOT_CONFIGURED', 'refuse mode surfaces the not-configured code');
      return true;
    },
  );
});

test('dev-echo mode via the app: register surfaces the devCode', async () => {
  // The app is built with devEcho enabled; a successful registration returns
  // the verification code in the API response for local testing (Req 13.4).
  const ctx = makeFactoryApp({ devEcho: true });
  try {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'dev-user@example.edu', name: 'Dev User', password: 'longenough1' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.devCode, 'devEcho registration should surface a devCode');
    assert.match(String(res.body.devCode), /^\d{6}$/, 'the surfaced code is a six-digit string');
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Production guard — verification codes are never surfaced in API responses.
// Validates: Requirements 20.3
// ---------------------------------------------------------------------------

test('production guard: with devEcho disabled, register omits devCode', async () => {
  // The reliable production configuration: devEcho off => the register response
  // never contains a verification code, regardless of NODE_ENV.
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const ctx = makeFactoryApp({ devEcho: false });
  try {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'prod-user@example.edu', name: 'Prod User', password: 'longenough1' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.devCode, undefined, 'no verification code may be exposed when devEcho is disabled');
  } finally {
    ctx.cleanup();
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

test('production hard-gate: NODE_ENV=production omits devCode even when devEcho is enabled', async () => {
  // Req 20.3 (task 11.1): the production hard-gate forces verification codes OFF
  // whenever NODE_ENV === 'production', REGARDLESS of DEV_ECHO_CODES/devEcho.
  // Even with devEcho explicitly enabled, a production environment must never
  // surface a code in the API response.
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const ctx = makeFactoryApp({ devEcho: true });
  try {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'prod-flag@example.edu', name: 'Prod Flag', password: 'longenough1' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    // The hard-gate wins over the devEcho flag in production.
    assert.equal(
      res.body.devCode,
      undefined,
      'no verification code may be exposed in production even when devEcho is enabled',
    );
  } finally {
    ctx.cleanup();
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

// ---------------------------------------------------------------------------
// Production admin-token guard — a production deployment refuses to start
// without a configured ADMIN_TOKEN (task 11.1).
// Validates: Requirements 20.3 (production requires a configured admin token)
// ---------------------------------------------------------------------------

test('production guard: makeApp refuses to start without a configured ADMIN_TOKEN', () => {
  purge(paths.SERVER_PATH);
  const { makeApp } = require(paths.SERVER_PATH);

  const originalEnv = process.env.NODE_ENV;
  const originalToken = process.env.ADMIN_TOKEN;
  process.env.NODE_ENV = 'production';
  delete process.env.ADMIN_TOKEN;
  try {
    assert.throws(
      () => makeApp({ dbPath: ':memory:' }),
      /ADMIN_TOKEN is required in production/,
      'production without an admin token must refuse to start',
    );

    // An explicitly-supplied admin token satisfies the guard (no throw).
    let ok;
    assert.doesNotThrow(() => {
      ok = makeApp({ dbPath: ':memory:', adminToken: 'prod-admin-token' });
    }, 'an explicit adminToken must satisfy the production guard');
    if (ok && ok.locals && ok.locals.db) ok.locals.db.close();
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
    purge(paths.SERVER_PATH);
  }
});

// ---------------------------------------------------------------------------
// No hard-coded credentials — transport config comes from env only.
// Validates: Requirements 13.5
// ---------------------------------------------------------------------------

test('no hard-coded credentials: transport configuration is derived only from env', () => {
  // Behavioral check: identical calls differing only by env flip configured
  // state, proving the module reads config from its env argument, not constants.
  assert.equal(email.isTransportConfigured({}), false);
  assert.equal(email.isTransportConfigured({ SMTP_HOST: 'smtp.env-only.edu' }), true);

  // Source check: the module must not embed SMTP host/credential literals. The
  // only literal address is the published CONTACT_EMAIL used in message bodies
  // (a contact address, not a transport credential).
  const src = fs.readFileSync(paths.EMAIL_PATH, 'utf8');
  assert.match(src, /env\.SMTP_HOST/, 'host must be read from the environment');
  assert.match(src, /env\.SMTP_USER/, 'user must be read from the environment');
  assert.match(src, /env\.SMTP_PASS/, 'password must be read from the environment');
  assert.match(src, /env\.MAIL_FROM/, 'sender must be read from the environment');
  assert.equal(email.CONTACT_EMAIL, 'reu@ualr.edu', 'contact email is body content, not a credential');
});
