'use strict';

/*
 * Feature: reu-recruitment-site — Deployment & Operational Readiness
 * smoke/integration tests (not property-based).
 *
 * Covers Requirement 20 (Deployment and Operational Readiness):
 *
 *   - Req 20.1: GET /api/health reports availability -> 200 {ok:true}.
 *   - Req 20.3: production guards — makeApp refuses to start in production
 *       without a configured admin token, starts fine with one, and the
 *       register endpoint NEVER exposes verification codes in a production
 *       environment (even with dev-echo enabled).
 *   - Req 20.2: durability — data written to a FIXED SQLite file + upload dir
 *       survives a simulated process restart (a second app instance pointed at
 *       the same on-disk paths still sees the seeded rows and transcript), and
 *       render.yaml declares a persistent disk mounted at the data directory.
 *
 * Validates: Requirements 20.1, 20.2, 20.3
 *
 * The production-guard tests mutate NODE_ENV / ADMIN_TOKEN on the process; each
 * snapshots and restores those keys in a `finally` block so state never leaks
 * to other tests.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const {
  makeFactoryApp,
  makeTempDataDir,
  purge,
  paths,
} = require('./helpers');

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

// A minimal but valid PDF byte stream so a seeded transcript is genuine bytes.
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);

/**
 * Snapshot the env keys the production-guard tests touch, run `fn`, then
 * restore them regardless of outcome. Also re-requires a clean server module
 * afterward so a mutated NODE_ENV never rides along in the require cache.
 */
async function withEnvIsolation(fn) {
  const KEYS = ['NODE_ENV', 'ADMIN_TOKEN', 'DEV_ECHO_CODES'];
  const snapshot = {};
  for (const k of KEYS) snapshot[k] = process.env[k];
  try {
    return await fn();
  } finally {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
    // Drop any server instance built under the mutated env.
    purge(paths.SERVER_PATH);
  }
}

/** Insert a verified user + application + on-disk transcript directly. */
function seedApplication(app, fields) {
  const db = app.locals.db;
  const userInfo = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, affiliation, verified, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(fields.email, 'x', fields.name, fields.affiliation, 1, new Date().toISOString());

  const transcriptFile = 'seed-' + userInfo.lastInsertRowid + '.pdf';
  fs.writeFileSync(path.join(app.locals.UPLOAD_DIR, transcriptFile), PDF_BYTES);

  db.prepare(
    `INSERT INTO applications (
      user_id, confirmation, submitted_at, first_name, last_name, email, phone,
      affiliation, citizenship, institution, institution_type, major, year,
      theme1, theme2, statement, ref1_name, ref1_email, ref2_name, ref2_email,
      first_gen, veteran, outreach, transcript_file
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    userInfo.lastInsertRowid,
    fields.confirmation,
    new Date().toISOString(),
    'Dana', 'Durable', fields.email, '501-555-0100',
    fields.affiliation, 'us_citizen', 'UA Little Rock', 'university',
    'Computer Science', 'sophomore', 'theme-ai', 'theme-security',
    'A personal statement recorded for this application.',
    'Dr. Ada Ref', 'ada@example.edu', 'Dr. Bob Ref', 'bob@example.edu',
    null, null, null, transcriptFile,
  );

  return { userId: userInfo.lastInsertRowid, transcriptFile };
}

// ---------------------------------------------------------------------------
// Req 20.1 — health check
// ---------------------------------------------------------------------------
test('GET /api/health reports availability with 200 {ok:true} (Req 20.1)', async () => {
  const ctx = makeFactoryApp({ adminToken: ADMIN_TOKEN });
  try {
    const res = await request(ctx.app).get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Req 20.3 — production guards
// ---------------------------------------------------------------------------
test('makeApp refuses to start in production without an admin token (Req 20.3)', async () => {
  await withEnvIsolation(() => {
    const server = require(paths.SERVER_PATH);
    const tmp = makeTempDataDir();
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ADMIN_TOKEN;

      assert.throws(
        () => server.makeApp({ dbPath: ':memory:', dataDir: tmp }),
        /ADMIN_TOKEN is required in production/,
        'production startup without a token must throw',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      purge(paths.SERVER_PATH);
    }
  });
});

test('makeApp starts in production when an explicit admin token is provided (Req 20.3)', async () => {
  await withEnvIsolation(() => {
    const server = require(paths.SERVER_PATH);
    const tmp = makeTempDataDir();
    let app;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ADMIN_TOKEN;

      assert.doesNotThrow(() => {
        app = server.makeApp({
          dbPath: ':memory:',
          dataDir: tmp,
          adminToken: ADMIN_TOKEN,
          transport: { sendVerificationCode() {}, async sendConfirmation() {} },
        });
      }, 'a configured admin token satisfies the production guard');
      assert.equal(app.locals.ADMIN_TOKEN, ADMIN_TOKEN);
    } finally {
      try { if (app && app.locals.db) app.locals.db.close(); } catch (_e) { /* noop */ }
      fs.rmSync(tmp, { recursive: true, force: true });
      purge(paths.SERVER_PATH);
    }
  });
});

test('register never exposes a verification code in production, even with dev-echo on (Req 20.3)', async () => {
  await withEnvIsolation(async () => {
    const server = require(paths.SERVER_PATH);
    const tmp = makeTempDataDir();
    let app;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_TOKEN = ADMIN_TOKEN;

      app = server.makeApp({
        dbPath: ':memory:',
        dataDir: tmp,
        adminToken: ADMIN_TOKEN,
        devEcho: true, // dev-echo requested, but production must hard-gate it OFF
        transport: { sendVerificationCode() {}, async sendConfirmation() {} },
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'prod-user@example.edu', name: 'Prod User', password: 'a-strong-password' });

      assert.equal(res.status, 201, 'registration succeeds');
      assert.equal(res.body.verified, false);
      assert.ok(!('devCode' in res.body), 'no devCode field is present in production responses');
    } finally {
      try { if (app && app.locals.db) app.locals.db.close(); } catch (_e) { /* noop */ }
      fs.rmSync(tmp, { recursive: true, force: true });
      purge(paths.SERVER_PATH);
    }
  });
});

test('register DOES echo the code outside production when dev-echo is on (control for Req 20.3)', async () => {
  await withEnvIsolation(async () => {
    const server = require(paths.SERVER_PATH);
    const tmp = makeTempDataDir();
    let app;
    try {
      process.env.NODE_ENV = 'development';
      process.env.ADMIN_TOKEN = ADMIN_TOKEN;

      app = server.makeApp({
        dbPath: ':memory:',
        dataDir: tmp,
        adminToken: ADMIN_TOKEN,
        devEcho: true,
        transport: { sendVerificationCode() {}, async sendConfirmation() {} },
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dev-user@example.edu', name: 'Dev User', password: 'a-strong-password' });

      assert.equal(res.status, 201);
      assert.ok('devCode' in res.body, 'dev-echo exposes the code outside production');
      assert.match(String(res.body.devCode), /^\d{6}$/, 'dev code is a 6-digit code');
    } finally {
      try { if (app && app.locals.db) app.locals.db.close(); } catch (_e) { /* noop */ }
      fs.rmSync(tmp, { recursive: true, force: true });
      purge(paths.SERVER_PATH);
    }
  });
});

// ---------------------------------------------------------------------------
// Req 20.2 — durability across a simulated process restart
// ---------------------------------------------------------------------------
test('seeded data + transcript survive a simulated process restart on the same disk (Req 20.2)', async () => {
  // A fixed data dir / db file that both "process lifetimes" point at. Using a
  // real file (not :memory:) is essential: :memory: would vanish on restart.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reu-durability-'));
  const dbPath = path.join(dataDir, 'applications.db');
  const confirmation = 'REU27-DUR001';
  const email = 'durable@ualr.edu';

  try {
    // --- First process lifetime: write data, then shut down. ---
    const first = makeFactoryApp({ adminToken: ADMIN_TOKEN, dbPath, dataDir });
    const seeded = seedApplication(first.app, {
      email, name: 'Dana Durable', affiliation: 'ualr', confirmation,
    });
    const transcriptPath = path.join(first.app.locals.UPLOAD_DIR, seeded.transcriptFile);
    assert.ok(fs.existsSync(transcriptPath), 'transcript written to the upload dir');
    // Closes the db connection (checkpoints WAL to the main file) and unloads
    // the module — the on-disk data/ store remains.
    first.cleanup();

    // --- Second process lifetime: same disk paths, brand-new app instance. ---
    const second = makeFactoryApp({ adminToken: ADMIN_TOKEN, dbPath, dataDir });
    try {
      // Direct DB read: the seeded rows are still there after "restart".
      const userRow = second.app.locals.db
        .prepare('SELECT email, affiliation, verified FROM users WHERE email = ?')
        .get(email);
      assert.ok(userRow, 'user row survived the restart');
      assert.equal(userRow.affiliation, 'ualr');

      const appRow = second.app.locals.db
        .prepare('SELECT confirmation, transcript_file FROM applications WHERE confirmation = ?')
        .get(confirmation);
      assert.ok(appRow, 'application row survived the restart');
      assert.equal(appRow.transcript_file, seeded.transcriptFile);

      // The uploaded transcript file is still on the persistent disk.
      const survivedTranscript = path.join(second.app.locals.UPLOAD_DIR, appRow.transcript_file);
      assert.ok(fs.existsSync(survivedTranscript), 'transcript file survived the restart');
      assert.ok(
        fs.readFileSync(survivedTranscript).slice(0, 5).toString('utf8') === '%PDF-',
        'transcript bytes are intact',
      );

      // End-to-end via the admin endpoint: the "restarted" server serves it.
      const res = await request(second.app)
        .get('/api/admin/applications')
        .set('Authorization', 'Bearer ' + ADMIN_TOKEN);
      assert.equal(res.status, 200);
      assert.equal(res.body.count, 1, 'restarted server exposes the persisted application');
      assert.equal(res.body.applications[0].confirmation, confirmation);
    } finally {
      second.cleanup();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('render.yaml declares a persistent disk mounted for the data directory (Req 20.2)', () => {
  const renderPath = path.join(paths.ROOT, 'render.yaml');
  assert.ok(fs.existsSync(renderPath), 'render.yaml exists at the app root');
  const yaml = fs.readFileSync(renderPath, 'utf8');

  assert.match(yaml, /disk:/, 'a disk block is declared');
  assert.match(yaml, /mountPath:\s*\/app\/data\b/, 'the disk is mounted at the data directory');
  assert.match(yaml, /name:\s*\S+/, 'the disk has a name');
  assert.match(yaml, /sizeGB:\s*\d+/, 'the disk declares a size so storage is durable');
  assert.match(yaml, /healthCheckPath:\s*\/api\/health\b/, 'the health-check path is wired for the platform');
});
