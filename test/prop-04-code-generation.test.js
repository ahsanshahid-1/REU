'use strict';

/*
 * Property 4: Generated codes are well-formed and always trigger a delivery
 * request (design.md — Correctness Properties).
 *
 *   For any registration or resend, the generated verification code SHALL be a
 *   six-digit numeric string (100000-999999) and the Account_Service SHALL
 *   request that the Email_Service deliver that exact code to the account
 *   email.
 *
 * Feature: reu-recruitment-site, Property 4: Generated codes are well-formed and always trigger a delivery request
 *
 * Validates: Requirements 11.3, 11.6
 *
 * Driven end-to-end through POST /api/auth/register and POST /api/auth/resend
 * with supertest against a throwaway in-memory database (makeFactoryApp). The
 * injected Email_Service transport RECORDS every sendVerificationCode(email,
 * code) call so the test can assert on the exact (email, code) the account
 * service asked to deliver.
 *
 * bcrypt cost 12 makes registration deliberately slow, so a single app
 * instance is shared across all iterations and each iteration performs one
 * register (one bcrypt) plus one resend (no bcrypt), yielding two delivery
 * probes per run while comfortably reaching the >= 100-iteration minimum.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');

// ---- recording transport ---------------------------------------------------

// Every sendVerificationCode(email, code) call is captured so assertions can
// inspect the exact arguments the Account_Service handed the Email_Service.
function makeRecordingTransport() {
  const calls = [];
  return {
    calls,
    sendVerificationCode(email, code) {
      calls.push({ email, code });
    },
    async sendConfirmation() {},
  };
}

// ---- generators -------------------------------------------------------------

// Local part: no whitespace or '@' so the result matches the server's
// EMAIL_RE. A monotonic suffix guarantees each generated email is unique across
// iterations, so the shared database never sees an accidental duplicate (which
// would short-circuit registration with a 409 before any code is generated).
let counter = 0;
const localPart = fc
  .stringMatching(/^[a-z0-9._-]{1,20}$/)
  .map((s) => `${s}u${counter++}`);

// Accounts require a .edu email (applicant-eligibility gate), so every
// generated account domain is educational.
const domain = fc.constantFrom(
  'ualr.edu',
  'trojans.ualr.edu',
  'example.edu',
  'university.edu',
);

const validEmail = fc
  .tuple(localPart, domain)
  .map(([local, dom]) => `${local}@${dom}`.toLowerCase());

const validName = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0);

const validPassword = fc.string({ minLength: 10, maxLength: 30 });

// ---- oracle -----------------------------------------------------------------

// A well-formed verification code is a six-digit numeric string whose integer
// value falls in [100000, 999999].
function assertWellFormedCode(code, context) {
  assert.equal(typeof code, 'string', `${context}: code should be a string`);
  assert.match(code, /^\d{6}$/, `${context}: code should be a six-digit numeric string (got ${JSON.stringify(code)})`);
  const n = Number(code);
  assert.ok(n >= 100000 && n <= 999999, `${context}: code ${n} should be in [100000, 999999]`);
}

// ---------------------------------------------------------------------------

test('Feature: reu-recruitment-site, Property 4: Generated codes are well-formed and always trigger a delivery request', async () => {
  const transport = makeRecordingTransport();
  const ctx = makeFactoryApp({ transport });

  try {
    await fc.assert(
      fc.asyncProperty(validEmail, validName, validPassword, async (email, name, password) => {
        const agent = request.agent(ctx.app);

        // ---- Registration: a delivery request for a well-formed code ----
        const before = transport.calls.length;
        const reg = await agent.post('/api/auth/register').send({ email, name, password });

        assert.equal(reg.status, 201, `expected 201 on registration, got ${reg.status}`);

        // Exactly one new delivery request was made by registration.
        assert.equal(
          transport.calls.length,
          before + 1,
          'registration should trigger exactly one verification delivery request',
        );
        const regCall = transport.calls[transport.calls.length - 1];

        // The request targeted the correct account email with a well-formed code.
        assert.equal(regCall.email, email, 'registration delivery must target the account email');
        assertWellFormedCode(regCall.code, 'register');

        // The exact code delivered is the code persisted on the account.
        const storedAfterReg = ctx.db
          .prepare('SELECT verify_code FROM users WHERE email = ?')
          .get(email);
        assert.equal(
          regCall.code,
          storedAfterReg.verify_code,
          'the delivered code must be the exact code recorded on the account',
        );

        // ---- Resend: a fresh well-formed code, delivered to the same email ----
        const beforeResend = transport.calls.length;
        const resend = await agent.post('/api/auth/resend').send({});

        assert.equal(resend.status, 200, `expected 200 on resend, got ${resend.status}`);

        // Exactly one new delivery request was made by resend.
        assert.equal(
          transport.calls.length,
          beforeResend + 1,
          'resend should trigger exactly one verification delivery request',
        );
        const resendCall = transport.calls[transport.calls.length - 1];

        assert.equal(resendCall.email, email, 'resend delivery must target the account email');
        assertWellFormedCode(resendCall.code, 'resend');

        // The resent code is the exact code now recorded on the account.
        const storedAfterResend = ctx.db
          .prepare('SELECT verify_code FROM users WHERE email = ?')
          .get(email);
        assert.equal(
          resendCall.code,
          storedAfterResend.verify_code,
          'the resent code must be the exact code newly recorded on the account',
        );
      }),
      { numRuns: 100 },
    );
  } finally {
    ctx.cleanup();
  }
});
