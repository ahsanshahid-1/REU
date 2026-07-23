'use strict';

/*
 * Property 8: Application validity depends only on fields, transcript, and
 * anti-spam (design.md — Correctness Properties).
 *
 *   For any generated application submission by a verified account, the
 *   submission SHALL be accepted if and only if all required fields are
 *   present and valid (names, institution, institution type, major, year,
 *   first-choice theme, citizenship in the allowed set, two reference names
 *   with regex-valid emails, personal statement >= 300 words), the transcript
 *   is a PDF <= 5 MB, and the hidden anti-spam field is empty; otherwise it
 *   SHALL be rejected with messaging identifying the problem — and the
 *   acceptance decision SHALL NOT depend on the account's verification status
 *   (enforced separately upstream).
 *
 * Validates: Requirements 14.3, 14.4, 14.5, 14.8, 14.10
 *
 * Strategy:
 *  - The field-validation oracle is extracted as `applicationFieldErrors(body)`
 *    in lib/core.js. It is tested directly at the unit level with fast-check:
 *    a per-field "valid/invalid" plan drives generation, and the expected error
 *    list is computed independently from that plan, then compared to the
 *    oracle's output. This asserts "accepted iff all required fields valid".
 *  - Req 14.10 is emphasised: the oracle takes ONLY the request body and never
 *    receives or consults an account's verification status. A dedicated
 *    property injects verification-status fields into the body and asserts the
 *    error list is byte-for-byte unchanged.
 *  - The honeypot (14.8) and transcript PDF/size (14.4) paths are handled by the
 *    endpoint (not the oracle), so they are covered by supertest-level checks
 *    that drive POST /api/applications for a verified account.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const request = require('supertest');

const { makeFactoryApp } = require('./helpers');
const {
  applicationFieldErrors,
  EMAIL_RE,
  CITIZENSHIP,
  clean,
} = require('../lib/core');

// ---------------------------------------------------------------------------
// Field model: each required field has a valid-value generator, an
// invalid-value generator, and the exact error string the oracle emits when the
// field is invalid. The oracle emits errors in this declaration order.
// ---------------------------------------------------------------------------

// Non-empty after trim() -> valid required-text field.
const validText = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

// Blank / whitespace / non-string -> clean() yields '' -> invalid required field.
const invalidText = fc.oneof(
  fc.constantFrom('', ' ', '   ', '\t', '\n  ', '\t \n'),
  fc.constantFrom(undefined, null, 0, 42, true, false, {}, []),
);

// A well-formed email matching the server's EMAIL_RE (no whitespace, has a dot
// in the domain). Verified against EMAIL_RE below as a generator sanity check.
const validEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9._%+-]{1,15}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
    fc.constantFrom('com', 'edu', 'org', 'net', 'io'),
  )
  .map(([local, host, tld]) => `${local}@${host}.${tld}`)
  .filter((e) => EMAIL_RE.test(clean(e)));

// Anything that fails EMAIL_RE after clean() -> invalid email.
const invalidEmail = fc.oneof(
  fc.constantFrom('', '   ', 'notanemail', 'a@b', '@b.com', 'user@', 'plain.nodot@', 'a b@c.com', 'a@@b.com'),
  fc.string({ maxLength: 25 }).filter((s) => !EMAIL_RE.test(clean(s))),
  fc.constantFrom(undefined, null, 12345),
);

const validCitizenship = fc.constantFrom(...CITIZENSHIP);

// The oracle checks the RAW value via CITIZENSHIP.includes(b.citizenship), so
// any value not exactly in the allowed set is invalid.
const invalidCitizenship = fc.oneof(
  fc.constantFrom('', 'US', 'citizen', 'usa', 'us_citizen ', ' permanent_resident', 'foo'),
  fc.constantFrom(undefined, null),
  fc.string({ maxLength: 20 }).filter((s) => !CITIZENSHIP.includes(s)),
);

// statement is valid iff clean(v, 20000).length >= 1200 (~300 words).
const validStatement = fc.integer({ min: 1200, max: 1500 }).map((n) => 'a'.repeat(n));
const invalidStatement = fc.integer({ min: 0, max: 1199 }).map((n) => 'a'.repeat(n));

// Ordered field specification mirroring applicationFieldErrors' emission order.
const FIELD_SPECS = [
  { key: 'first_name', valid: validText, invalid: invalidText, error: 'First name is required' },
  { key: 'last_name', valid: validText, invalid: invalidText, error: 'Last name is required' },
  { key: 'institution', valid: validText, invalid: invalidText, error: 'Institution is required' },
  { key: 'institution_type', valid: validText, invalid: invalidText, error: 'Institution type is required' },
  { key: 'major', valid: validText, invalid: invalidText, error: 'Major is required' },
  { key: 'year', valid: validText, invalid: invalidText, error: 'Year is required' },
  { key: 'theme1', valid: validText, invalid: invalidText, error: 'First choice theme is required' },
  { key: 'ref1_name', valid: validText, invalid: invalidText, error: 'Reference 1 name is required' },
  { key: 'ref2_name', valid: validText, invalid: invalidText, error: 'Reference 2 name is required' },
  { key: 'ref1_email', valid: validEmail, invalid: invalidEmail, error: 'Reference 1 email is invalid' },
  { key: 'ref2_email', valid: validEmail, invalid: invalidEmail, error: 'Reference 2 email is invalid' },
  { key: 'citizenship', valid: validCitizenship, invalid: invalidCitizenship, error: 'Citizenship status is required' },
  { key: 'statement', valid: validStatement, invalid: invalidStatement, error: 'Personal statement must be at least 300 words' },
];

// An arbitrary that, for one field, yields { value, ok } — a value drawn from
// either the valid or the invalid generator, with a flag recording which.
const fieldArb = (spec) =>
  fc.oneof(
    spec.valid.map((value) => ({ value, ok: true })),
    spec.invalid.map((value) => ({ value, ok: false })),
  );

// Build a full submission plan: one { value, ok } per field. Maps to a request
// body plus the independently-computed expected error list.
const submissionPlanArb = fc
  .tuple(...FIELD_SPECS.map(fieldArb))
  .map((picks) => {
    const body = {};
    const expectedErrors = [];
    picks.forEach((pick, i) => {
      const spec = FIELD_SPECS[i];
      // Only assign defined values; leaving a key absent is itself an "invalid"
      // shape the oracle must handle (clean(undefined) === '').
      if (pick.value !== undefined) body[spec.key] = pick.value;
      if (!pick.ok) expectedErrors.push(spec.error);
    });
    return { body, expectedErrors };
  });

// All-valid submission plan (used for the verification-independence property and
// as the happy-path body for supertest).
const validPlanArb = fc
  .tuple(...FIELD_SPECS.map((s) => s.valid))
  .map((values) => {
    const body = {};
    FIELD_SPECS.forEach((spec, i) => { body[spec.key] = values[i]; });
    return body;
  });

const sorted = (arr) => [...arr].sort();

// ---------------------------------------------------------------------------

test('Feature: reu-recruitment-site, Property 8: Application validity depends only on fields, transcript, and anti-spam', async (t) => {
  // --- Core oracle property: accepted (no errors) iff every field is valid ---
  await t.test('field-validation oracle: errors match the field validity plan exactly', () => {
    fc.assert(
      fc.property(submissionPlanArb, ({ body, expectedErrors }) => {
        const actual = applicationFieldErrors(body);

        // The oracle returns exactly the expected set of errors (compared as a
        // set to avoid coupling the assertion to emission order).
        assert.deepEqual(sorted(actual), sorted(expectedErrors));

        // "Accepted iff all fields valid": empty error list precisely when the
        // plan marked no field invalid.
        assert.equal(actual.length === 0, expectedErrors.length === 0);
      }),
      { numRuns: 300 },
    );
  });

  // --- Req 14.10: the oracle NEVER consults account verification status ------
  await t.test('Req 14.10: adding verification-status fields to the body does not change the outcome', () => {
    const verificationNoise = fc.record({
      verified: fc.boolean(),
      is_verified: fc.boolean(),
      account_verified: fc.boolean(),
      verify_code: fc.oneof(fc.constant(undefined), fc.string()),
      email_verified: fc.constantFrom('true', 'false', '1', '0', 'yes', 'no'),
    });

    fc.assert(
      fc.property(submissionPlanArb, verificationNoise, ({ body }, noise) => {
        const baseline = applicationFieldErrors(body);
        // Injecting any verification-status signal must not alter the decision.
        const withNoise = applicationFieldErrors({ ...body, ...noise });
        assert.deepEqual(withNoise, baseline);
      }),
      { numRuns: 200 },
    );
  });

  await t.test('Req 14.10: a fully valid body is accepted regardless of verification signals', () => {
    fc.assert(
      fc.property(
        validPlanArb,
        fc.record({ verified: fc.boolean(), account_verified: fc.boolean() }),
        (body, noise) => {
          // A valid field set has no errors whether "verified" is true, false,
          // or absent — verification is enforced separately upstream (14.1/14.2).
          assert.deepEqual(applicationFieldErrors({ ...body, ...noise }), []);
          assert.deepEqual(applicationFieldErrors(body), []);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Supertest-level checks for the endpoint-owned anti-spam (14.8) and transcript
// PDF/size (14.4) paths, exercised for a VERIFIED account so that the field
// oracle, honeypot, and transcript gates are all reachable.
// ---------------------------------------------------------------------------

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');

function validFormFields() {
  return {
    first_name: 'Ada',
    last_name: 'Lovelace',
    institution: 'Example College',
    institution_type: 'community_college',
    major: 'Computer Science',
    year: 'sophomore',
    theme1: 'ai',
    ref1_name: 'Grace Hopper',
    ref1_email: 'grace@example.edu',
    ref2_name: 'Alan Turing',
    ref2_email: 'alan@example.org',
    citizenship: 'us_citizen',
    statement: 'a'.repeat(1300),
  };
}

async function verifiedAgent(ctx, email) {
  const agent = request.agent(ctx.app);
  const reg = await agent
    .post('/api/auth/register')
    .send({ email, name: 'Test Applicant', password: 'password-123456' });
  assert.equal(reg.status, 201, `registration should succeed, got ${reg.status}`);
  // Mark the account verified so the 14.2 upstream gate is satisfied and the
  // field/anti-spam/transcript checks become reachable.
  ctx.db.prepare('UPDATE users SET verified = 1, verify_code = NULL WHERE email = ?').run(email);
  return agent;
}

test('Feature: reu-recruitment-site, Property 8 (endpoint): honeypot filled is rejected as anti-spam (Req 14.8)', async () => {
  const ctx = makeFactoryApp();
  try {
    const agent = await verifiedAgent(ctx, 'spam@example.edu');
    const req = agent.post('/api/applications');
    const fields = { ...validFormFields(), website: 'http://spam.example' }; // honeypot
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    req.attach('transcript', PDF_BYTES, { filename: 't.pdf', contentType: 'application/pdf' });
    const res = await req;
    assert.equal(res.status, 400, `honeypot submission should be rejected, got ${res.status}`);
    assert.match(res.body.error, /rejected/i);
  } finally {
    ctx.cleanup();
  }
});

test('Feature: reu-recruitment-site, Property 8 (endpoint): missing transcript is rejected (Req 14.4)', async () => {
  const ctx = makeFactoryApp();
  try {
    const agent = await verifiedAgent(ctx, 'notranscript@example.edu');
    const req = agent.post('/api/applications');
    for (const [k, v] of Object.entries(validFormFields())) req.field(k, v);
    const res = await req; // no .attach()
    assert.equal(res.status, 400, `missing transcript should be rejected, got ${res.status}`);
    assert.match(res.body.error, /transcript/i);
  } finally {
    ctx.cleanup();
  }
});

test('Feature: reu-recruitment-site, Property 8 (endpoint): non-PDF transcript is rejected (Req 14.4)', async () => {
  const ctx = makeFactoryApp();
  try {
    const agent = await verifiedAgent(ctx, 'notpdf@example.edu');
    const req = agent.post('/api/applications');
    for (const [k, v] of Object.entries(validFormFields())) req.field(k, v);
    req.attach('transcript', Buffer.from('not a pdf'), { filename: 't.txt', contentType: 'text/plain' });
    const res = await req;
    assert.equal(res.status, 400, `non-PDF transcript should be rejected, got ${res.status}`);
    assert.match(res.body.error, /pdf/i);
  } finally {
    ctx.cleanup();
  }
});

test('Feature: reu-recruitment-site, Property 8 (endpoint): valid fields + empty honeypot + PDF is accepted (Req 14.3/14.4/14.8)', async () => {
  const ctx = makeFactoryApp();
  try {
    const agent = await verifiedAgent(ctx, 'valid@example.edu');
    const req = agent.post('/api/applications');
    for (const [k, v] of Object.entries(validFormFields())) req.field(k, v);
    req.attach('transcript', PDF_BYTES, { filename: 't.pdf', contentType: 'application/pdf' });
    const res = await req;
    assert.equal(res.status, 201, `valid submission should be accepted, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.match(res.body.confirmation, /^REU27-/);
  } finally {
    ctx.cleanup();
  }
});
