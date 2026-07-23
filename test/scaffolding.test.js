'use strict';

/*
 * Scaffolding smoke tests (Requirement 20.1).
 *
 * These confirm the test tooling itself is wired up: node:test runs, supertest
 * can drive the exported app against a throwaway database, fast-check is
 * available for property tests, and the HTML parser is available for later
 * content assertions. They do not exercise feature behavior — that arrives in
 * the tasks that follow.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');
const { parse } = require('node-html-parser');

const { buildTestApp } = require('./helpers');

test('exported app serves /api/health against a throwaway database', async () => {
  const ctx = buildTestApp();
  try {
    const res = await request(ctx.app).get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.ok(ctx.dataDir, 'a temporary data directory was created');
    assert.ok(ctx.db, 'the app exposes its database handle for tests');
  } finally {
    ctx.cleanup();
  }
});

test('each buildTestApp() instance is isolated', async () => {
  const a = buildTestApp();
  const b = buildTestApp();
  try {
    assert.notEqual(a.dataDir, b.dataDir);
    const [ra, rb] = await Promise.all([
      request(a.app).get('/api/health'),
      request(b.app).get('/api/health'),
    ]);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('fast-check is available and runs properties', () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (x, y) => x + y === y + x),
    { numRuns: 100 },
  );
});

test('HTML parser is available for content assertions', () => {
  const root = parse('<main id="main"><a class="skip" href="#main">Skip</a></main>');
  assert.equal(root.querySelector('#main').tagName, 'MAIN');
  assert.equal(root.querySelector('a.skip').text, 'Skip');
});
