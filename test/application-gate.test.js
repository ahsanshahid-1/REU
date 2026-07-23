'use strict';

/*
 * Feature: reu-recruitment-site — Application_Form access-gate example/integration tests.
 *
 * These are example/integration tests (not property-based) covering the two
 * upstream access gates on application submission, plus the voluntary-demographic
 * presentation contract on the apply form:
 *
 *   - Req 14.1: an unauthenticated visitor cannot submit — POST /api/applications
 *       with no session is rejected with 401 and prompted to sign in.
 *   - Req 14.2: an authenticated-but-unverified account cannot submit — the
 *       endpoint requires email verification first and responds 403.
 *   - Req 14.9: the apply form presents voluntary demographic questions
 *       (first_gen, veteran, outreach) as optional and states they are not used
 *       in eligibility or selection.
 *
 * Validates: Requirements 14.1, 14.2, 14.9
 *
 * For 14.1/14.2 we drive the real Express app via supertest. The unverified
 * account + session are seeded directly through app.locals.db so we exercise the
 * gate without the full register -> verify flow. For 14.9 we parse the static
 * public/apply.html with node-html-parser and assert on the DOM.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { parse } = require('node-html-parser');

const { makeFactoryApp, paths } = require('./helpers');

const APPLY_HTML_PATH = path.join(paths.ROOT, 'public', 'apply.html');

/** Seed an account (verified or not) plus a live session; return the session token. */
function seedUserWithSession(app, { email, verified }) {
  const db = app.locals.db;
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, affiliation, verified, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(email, 'x', 'Test Applicant', 'external', verified ? 1 : 0, new Date().toISOString());

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .run(token, info.lastInsertRowid, expires);

  return { userId: info.lastInsertRowid, token };
}

test('unauthenticated POST /api/applications is rejected with a sign-in prompt (Req 14.1)', async () => {
  const ctx = makeFactoryApp();
  try {
    const res = await request(ctx.app)
      .post('/api/applications')
      .field('first_name', 'Nobody');

    assert.equal(res.status, 401, 'no session -> unauthorized');
    assert.ok(res.body.error, 'response carries an error message');
    assert.match(res.body.error, /sign in/i, 'prompts the visitor to sign in');
  } finally {
    ctx.cleanup();
  }
});

test('authenticated-but-unverified POST /api/applications requires verification (Req 14.2)', async () => {
  const ctx = makeFactoryApp();
  try {
    const { token } = seedUserWithSession(ctx.app, {
      email: 'unverified@example.edu',
      verified: false,
    });

    const res = await request(ctx.app)
      .post('/api/applications')
      .set('Cookie', 'session=' + token)
      .field('first_name', 'Uma')
      .field('last_name', 'Verified');

    assert.equal(res.status, 403, 'signed in but unverified -> forbidden');
    assert.ok(res.body.error, 'response carries an error message');
    assert.match(res.body.error, /verify/i, 'requires the applicant to verify their email first');
  } finally {
    ctx.cleanup();
  }
});

test('a verified session passes both gates and is not blocked by 401/403 (Req 14.1, 14.2 control)', async () => {
  // Control case: proves the 401/403 gates key on auth+verification specifically,
  // not on some unrelated request property. A verified account gets past both
  // gates and is stopped later by field/transcript validation (a 4xx that is
  // neither 401 nor 403).
  const ctx = makeFactoryApp();
  try {
    const { token } = seedUserWithSession(ctx.app, {
      email: 'verified@example.edu',
      verified: true,
    });

    const res = await request(ctx.app)
      .post('/api/applications')
      .set('Cookie', 'session=' + token)
      .field('first_name', 'Vera');

    assert.notEqual(res.status, 401, 'verified session is authenticated');
    assert.notEqual(res.status, 403, 'verified session is not blocked by the verification gate');
  } finally {
    ctx.cleanup();
  }
});

test('apply form presents voluntary demographics as optional and not used in selection (Req 14.9)', () => {
  const html = fs.readFileSync(APPLY_HTML_PATH, 'utf8');
  const root = parse(html);

  const demographicIds = ['first_gen', 'veteran', 'outreach'];
  const fields = demographicIds.map((id) => {
    const el = root.querySelector('#' + id);
    assert.ok(el, `demographic field #${id} is present on the apply form`);
    return el;
  });

  // Each demographic field is optional: no `required` attribute.
  for (const el of fields) {
    assert.equal(
      el.getAttribute('required'),
      undefined,
      `demographic field #${el.getAttribute('id')} must not be required`,
    );
  }

  // The demographic fields live in a shared section that must label them optional
  // and state they are not used in eligibility or selection.
  const fieldset = fields[0].closest('fieldset');
  assert.ok(fieldset, 'demographic fields are grouped in a fieldset');
  const sectionText = fieldset.text.replace(/\s+/g, ' ').trim();

  assert.match(sectionText, /optional/i, 'the demographic section is labeled optional');
  assert.match(
    sectionText,
    /(not|never) used in eligibility or selection/i,
    'the demographic section states the fields are not used in eligibility or selection',
  );
});
