'use strict';

/*
 * Test harness for the REU recruitment site.
 *
 * `buildTestApp()` returns a fresh Express `app` (the one exported by
 * server.js) backed by a throwaway SQLite database in a temporary directory,
 * so tests can drive it with supertest without binding a port or touching the
 * real `data/` store. Each call constructs an isolated app + database.
 *
 * The harness can also inject mocks for the two external dependencies the
 * design's Testing Strategy calls out:
 *   - the Email_Service transport (lib/email.js) — so verification/confirmation
 *     sends can be driven to succeed or fail deterministically, and
 *   - the chatbot upstream (the HF chat-completions endpoint that lib/chatbot.js
 *     reaches via global.fetch) — so Assistant mode selection and fallback can
 *     be forced without network access.
 *
 * Usage:
 *   const { buildTestApp } = require('./helpers');
 *   const ctx = buildTestApp();
 *   const res = await request(ctx.app).get('/api/health');
 *   ctx.cleanup();
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'server.js');
const CHATBOT_PATH = path.join(ROOT, 'lib', 'chatbot.js');
const EMAIL_PATH = path.join(ROOT, 'lib', 'email.js');

// Env keys the harness manipulates; snapshotted and restored on cleanup.
const MANAGED_ENV_KEYS = [
  'REU_DATA_DIR', 'ADMIN_TOKEN', 'NODE_ENV', 'DEV_ECHO_CODES', 'HF_TOKEN',
  'HUGGINGFACE_API_KEY', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE',
  'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
];

/** Create a fresh, empty temporary data directory (removed on cleanup). */
function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reu-test-'));
}

/** Drop a module from the require cache so it is re-evaluated on next require. */
function purge(absPath) {
  try {
    delete require.cache[require.resolve(absPath)];
  } catch (_e) {
    // Not resolvable (e.g. lib/email.js does not exist yet) — nothing to purge.
  }
}

/**
 * Register a fake module in the require cache so a later `require(absPath)`
 * returns `exportsObj`. `absPath` must be a real file on disk (Node resolves
 * the specifier to a filename before consulting the cache), otherwise the
 * injection is skipped and `false` is returned.
 */
function injectModule(absPath, exportsObj) {
  if (!fs.existsSync(absPath)) return false;
  const m = new Module(absPath, module);
  m.filename = absPath;
  m.loaded = true;
  m.exports = exportsObj;
  require.cache[absPath] = m;
  return true;
}

/**
 * Build an isolated app instance.
 *
 * @param {object} [options]
 * @param {object} [options.env]          Extra environment variables to set.
 * @param {string} [options.adminToken]   ADMIN_TOKEN for the instance.
 * @param {string} [options.nodeEnv]      NODE_ENV for the instance.
 * @param {boolean} [options.devEcho]     Set DEV_ECHO_CODES=1 when true.
 * @param {object} [options.chatbotMock]  Replaces the lib/chatbot module.
 * @param {object} [options.emailMock]    Replaces the lib/email module (once it exists).
 * @param {(input:any, init:any)=>Promise<any>} [options.fetchMock]
 *                                         Replaces global.fetch (the chatbot upstream).
 * @returns {{ app: import('express').Express, dataDir: string, adminToken: string,
 *            db: any, cleanup: () => void }}
 */
function buildTestApp(options = {}) {
  const dataDir = options.dataDir || makeTempDataDir();
  const adminToken = options.adminToken || 'test-admin-token-0123456789abcdef';

  // Snapshot managed env so cleanup can restore the process environment.
  const envSnapshot = {};
  for (const key of MANAGED_ENV_KEYS) envSnapshot[key] = process.env[key];

  process.env.REU_DATA_DIR = dataDir;
  process.env.ADMIN_TOKEN = adminToken;
  process.env.NODE_ENV = options.nodeEnv || 'test';
  if (options.devEcho) process.env.DEV_ECHO_CODES = '1';
  else delete process.env.DEV_ECHO_CODES;
  if (options.env) Object.assign(process.env, options.env);

  // Rebuild server (and its deps) fresh so a new app + database are created.
  purge(SERVER_PATH);
  purge(CHATBOT_PATH);
  purge(EMAIL_PATH);

  if (options.chatbotMock) injectModule(CHATBOT_PATH, options.chatbotMock);
  if (options.emailMock) injectModule(EMAIL_PATH, options.emailMock);

  // Mock the chatbot upstream by stubbing global.fetch, keeping the real
  // retrieval/fallback pipeline intact.
  const originalFetch = global.fetch;
  if (options.fetchMock) global.fetch = options.fetchMock;

  const app = require(SERVER_PATH);
  const db = app.locals.db;

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;

    if (options.fetchMock) global.fetch = originalFetch;

    try {
      if (db && typeof db.close === 'function') db.close();
    } catch (_e) { /* already closed */ }

    purge(SERVER_PATH);
    purge(CHATBOT_PATH);
    purge(EMAIL_PATH);

    // Restore managed environment.
    for (const key of MANAGED_ENV_KEYS) {
      if (envSnapshot[key] === undefined) delete process.env[key];
      else process.env[key] = envSnapshot[key];
    }

    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_e) { /* best effort */ }
  }

  return { app, dataDir, adminToken, db, cleanup };
}

/**
 * Convenience factory for a chatbot-upstream fetch mock.
 * @param {(messages:any)=>string|{status?:number, content?:string}} responder
 *   Returns the assistant text, or an object to control the HTTP status.
 */
function makeChatUpstreamMock(responder) {
  return async function fetchMock(_url, init) {
    let messages = [];
    try {
      messages = JSON.parse(init && init.body ? init.body : '{}').messages || [];
    } catch (_e) { /* ignore */ }
    const out = typeof responder === 'function' ? responder(messages) : responder;
    const result = typeof out === 'string' ? { content: out } : (out || {});
    const status = result.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { content: result.content || '' } }] }),
      text: async () => result.content || '',
    };
  };
}

/** A fetch mock that always fails the upstream request (network error). */
function failingChatUpstreamMock() {
  return async function fetchMock() {
    throw new Error('simulated upstream failure');
  };
}

/**
 * Build an app directly via server.js's `makeApp` factory, backed by an
 * in-memory SQLite database and an injectable Email_Service transport. This is
 * a lighter-weight alternative to `buildTestApp` for tests that want to assert
 * on the transport (e.g. that a verification code delivery was requested)
 * without going through the require-cache/env dance.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath]     Defaults to ':memory:'.
 * @param {object} [options.transport]  Email_Service transport override.
 * @param {string} [options.adminToken] Admin bearer token.
 * @param {boolean} [options.devEcho]   Echo verification codes in responses.
 * @returns {{ app: import('express').Express, db: any, adminToken: string,
 *            transport: object, cleanup: () => void }}
 */
function makeFactoryApp(options = {}) {
  purge(SERVER_PATH);
  if (options.chatbotMock) injectModule(CHATBOT_PATH, options.chatbotMock);
  if (options.emailMock) injectModule(EMAIL_PATH, options.emailMock);

  const originalFetch = global.fetch;
  if (options.fetchMock) global.fetch = options.fetchMock;

  const server = require(SERVER_PATH);
  // Default injected transport: a synchronous no-op that resolves both required
  // sends. `sendConfirmation` is included so application-submission flows exercise
  // the confirmation path without a real mail transport (the server also guards a
  // missing method, but providing it keeps the success path explicit).
  const transport = options.transport || {
    sendVerificationCode() {},
    async sendConfirmation() {},
  };
  const app = server.makeApp({
    dbPath: options.dbPath || ':memory:',
    dataDir: options.dataDir || makeTempDataDir(),
    transport,
    adminToken: options.adminToken || 'test-admin-token-0123456789abcdef',
    devEcho: options.devEcho,
    // Forwarded so rate-limiting tests can enable/configure the limiter on an
    // isolated instance; omitted (undefined) leaves the env/production default,
    // which is OFF in the test environment so the property suite is not throttled.
    rateLimit: options.rateLimit,
  });
  const db = app.locals.db;

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (options.fetchMock) global.fetch = originalFetch;
    try { if (db && typeof db.close === 'function') db.close(); } catch (_e) { /* already closed */ }
    purge(SERVER_PATH);
    purge(CHATBOT_PATH);
    purge(EMAIL_PATH);
  }

  return { app, db, adminToken: app.locals.ADMIN_TOKEN, transport, cleanup };
}

module.exports = {
  buildTestApp,
  makeFactoryApp,
  makeTempDataDir,
  injectModule,
  purge,
  makeChatUpstreamMock,
  failingChatUpstreamMock,
  paths: { ROOT, SERVER_PATH, CHATBOT_PATH, EMAIL_PATH },
};
