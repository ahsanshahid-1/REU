'use strict';

/*
 * Feature: reu-recruitment-site — Admin_Panel example/integration tests.
 *
 * These are example/integration tests (not property-based) covering the admin
 * review endpoints with a valid bearer token:
 *
 *   - GET /api/admin/applications  -> auto-returns {count, internal, external,
 *       applications[]} in a single call, with the internal/external breakdown
 *       derived from affiliation.                                (Req 15.2)
 *   - GET /api/admin/applications/:id -> full record for one application.
 *                                                                (Req 15.3)
 *   - GET /api/admin/transcript/:id   -> the transcript PDF as a download.
 *                                                                (Req 15.4)
 *   - unknown id on both detail and transcript -> 404.           (Req 15.6)
 *
 * Validates: Requirements 15.2, 15.3, 15.4, 15.6
 *
 * We seed applications directly through app.locals.db (faster and deterministic
 * than the full register -> verify -> apply flow) and drop a transcript file in
 * app.locals.UPLOAD_DIR so the download path serves real bytes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { makeFactoryApp } = require('./helpers');

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
const AUTH = 'Bearer ' + ADMIN_TOKEN;

// A minimal but valid PDF byte stream so the download is a genuine PDF file.
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);

/**
 * Insert a user + application pair directly into the database. Returns the new
 * application's id and the on-disk transcript filename.
 *
 * @param {object} app     The Express app (for app.locals.db / UPLOAD_DIR).
 * @param {object} fields  { email, affiliation, first_name, last_name, ... }
 */
function seedApplication(app, fields) {
  const db = app.locals.db;
  const email = fields.email;
  const affiliation = fields.affiliation; // 'ualr' | 'external'

  const userInfo = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, affiliation, verified, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(email, 'x', fields.first_name + ' ' + fields.last_name, affiliation, 1, new Date().toISOString());

  // Write a real transcript file into the upload dir and reference it by name.
  const transcriptFile = 'seed-' + userInfo.lastInsertRowid + '.pdf';
  fs.writeFileSync(path.join(app.locals.UPLOAD_DIR, transcriptFile), PDF_BYTES);

  const confirmation = fields.confirmation;
  const appInfo = db
    .prepare(
      `INSERT INTO applications (
        user_id, confirmation, submitted_at, first_name, last_name, email, phone,
        affiliation, citizenship, institution, institution_type, major, year,
        theme1, theme2, statement, ref1_name, ref1_email, ref2_name, ref2_email,
        first_gen, veteran, outreach, transcript_file
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      userInfo.lastInsertRowid,
      confirmation,
      new Date().toISOString(),
      fields.first_name,
      fields.last_name,
      email,
      '501-555-0100',
      affiliation,
      'us_citizen',
      fields.institution,
      fields.institution_type || 'university',
      'Computer Science',
      'sophomore',
      'theme-ai',
      'theme-security',
      'A personal statement recorded for this application.',
      'Dr. Ada Ref',
      'ada@example.edu',
      'Dr. Bob Ref',
      'bob@example.edu',
      null,
      null,
      null,
      transcriptFile,
    );

  return { id: appInfo.lastInsertRowid, transcriptFile, confirmation };
}

test('admin list auto-returns count + internal/external breakdown in one call (Req 15.2)', async () => {
  const ctx = makeFactoryApp({ adminToken: ADMIN_TOKEN });
  try {
    // Two internal (ualr) + one external application.
    seedApplication(ctx.app, {
      email: 'stu1@ualr.edu', affiliation: 'ualr', first_name: 'Alice', last_name: 'Intern',
      institution: 'UA Little Rock', confirmation: 'REU27-AAA111',
    });
    seedApplication(ctx.app, {
      email: 'stu2@trojans.ualr.edu', affiliation: 'ualr', first_name: 'Cara', last_name: 'Intern',
      institution: 'UA Little Rock', confirmation: 'REU27-AAA222',
    });
    seedApplication(ctx.app, {
      email: 'stu3@example.edu', affiliation: 'external', first_name: 'Ben', last_name: 'Extern',
      institution: 'State College', confirmation: 'REU27-BBB111',
    });

    const res = await request(ctx.app)
      .get('/api/admin/applications')
      .set('Authorization', AUTH);

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 3, 'count reflects all seeded applications');
    assert.equal(res.body.internal, 2, 'internal = ualr affiliation count');
    assert.equal(res.body.external, 1, 'external = non-ualr count');
    assert.ok(Array.isArray(res.body.applications), 'applications is an array');
    assert.equal(res.body.applications.length, 3, 'list returned in the same response');
    assert.equal(res.body.internal + res.body.external, res.body.count, 'breakdown sums to count');
  } finally {
    ctx.cleanup();
  }
});

test('admin detail returns a single application full record (Req 15.3)', async () => {
  const ctx = makeFactoryApp({ adminToken: ADMIN_TOKEN });
  try {
    const seeded = seedApplication(ctx.app, {
      email: 'detail@ualr.edu', affiliation: 'ualr', first_name: 'Dana', last_name: 'Detail',
      institution: 'UA Little Rock', confirmation: 'REU27-DET001',
    });

    const res = await request(ctx.app)
      .get('/api/admin/applications/' + seeded.id)
      .set('Authorization', AUTH);

    assert.equal(res.status, 200);
    assert.equal(res.body.id, seeded.id);
    assert.equal(res.body.confirmation, 'REU27-DET001');
    assert.equal(res.body.first_name, 'Dana');
    assert.equal(res.body.last_name, 'Detail');
    assert.equal(res.body.email, 'detail@ualr.edu');
    // Full record includes fields omitted from the list/CSV surfaces.
    assert.ok('statement' in res.body, 'detail includes the full statement field');
    assert.ok('ref1_email' in res.body, 'detail includes reference fields');
  } finally {
    ctx.cleanup();
  }
});

test('admin transcript endpoint returns the PDF as a download (Req 15.4)', async () => {
  const ctx = makeFactoryApp({ adminToken: ADMIN_TOKEN });
  try {
    const seeded = seedApplication(ctx.app, {
      email: 'pdf@ualr.edu', affiliation: 'ualr', first_name: 'Pat', last_name: 'Pdf',
      institution: 'UA Little Rock', confirmation: 'REU27-PDF001',
    });

    const res = await request(ctx.app)
      .get('/api/admin/transcript/' + seeded.id)
      .set('Authorization', AUTH)
      .buffer(true)
      .parse((response, cb) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'] || '', /attachment/, 'served as a download');
    assert.match(res.headers['content-disposition'] || '', /REU27-PDF001/, 'download named by confirmation');
    assert.match(res.headers['content-type'] || '', /pdf/i, 'content-type is a PDF');
    assert.ok(Buffer.isBuffer(res.body), 'body is raw bytes');
    assert.ok(res.body.slice(0, 5).toString('utf8') === '%PDF-', 'body starts with the PDF signature');
  } finally {
    ctx.cleanup();
  }
});

test('admin detail returns 404 for an unknown application id (Req 15.6)', async () => {
  const ctx = makeFactoryApp({ adminToken: ADMIN_TOKEN });
  try {
    const res = await request(ctx.app)
      .get('/api/admin/applications/999999')
      .set('Authorization', AUTH);

    assert.equal(res.status, 404);
    assert.ok(res.body.error, 'not-found response carries an error message');
  } finally {
    ctx.cleanup();
  }
});

test('admin transcript returns 404 for an unknown application id (Req 15.6)', async () => {
  const ctx = makeFactoryApp({ adminToken: ADMIN_TOKEN });
  try {
    const res = await request(ctx.app)
      .get('/api/admin/transcript/999999')
      .set('Authorization', AUTH);

    assert.equal(res.status, 404);
    assert.ok(res.body.error, 'not-found response carries an error message');
  } finally {
    ctx.cleanup();
  }
});
