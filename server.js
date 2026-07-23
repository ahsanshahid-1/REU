/* REU recruitment site backend — with applicant accounts
   Auth model:
   - Applicants register with email + password (bcrypt) and verify by code.
   - Affiliation is derived from the email domain:
       @ualr.edu / @trojans.ualr.edu  -> 'ualr'   (internal, campus student)
       anything else                  -> 'external'
     Email verification is what proves the affiliation, so applying
     requires a verified account.
   - Sessions: random 256-bit token in an httpOnly cookie, stored in SQLite.
   - Campus SSO: UA Little Rock runs Microsoft 365, so production can add
     OIDC (Azure AD) sign-in for @ualr.edu accounts; the mount point is
     /auth/sso below with integration notes. Password auth remains for
     external students.
   - Staff/admin: separate Bearer token (ADMIN_TOKEN), unchanged.

   Testability:
   - The Express app is built by the `makeApp({ dbPath, dataDir, transport,
     adminToken, devEcho })` factory so tests can drive an isolated instance
     backed by a throwaway/`:memory:` SQLite database and an injectable
     Email_Service transport, without binding a port.
   - `module.exports` is the default (env-configured) app, with `makeApp`
     attached, so `require('./server')` keeps returning the app. A listening
     server is started only when the file is run directly.
*/
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const chatbot = require('./lib/chatbot');
const {
  EMAIL_RE,
  clean,
  affiliationOf,
  isEduEmail,
  applicationFieldErrors,
  buildApplicationsCsv,
  buildShowcase,
} = require('./lib/core');

const PORT = process.env.PORT || 3000;
const DEV_ECHO_CODES = process.env.DEV_ECHO_CODES === '1'; // echo verify codes in API responses (dev only!)
const SESSION_DAYS = 14;

// ---------- stateless helpers (no per-app state) ----------
// Pure request-independent logic (affiliation derivation, the application
// field-validation oracle, and the CSV builder) lives in lib/core.js so it can
// be tested in isolation; it is imported above and used unchanged here.

/*
 * Default Email_Service transport (Requirement 13).
 *
 * The real nodemailer-backed Email_Service lives in `lib/email.js` and exposes
 * both `sendVerificationCode(email, code)` and
 * `sendConfirmation(email, confirmationNumber)` as Promise-returning calls that
 * reject on delivery failure (SMTP mode) or in refuse mode, and resolve in SMTP
 * (`sent`) and dev-echo (`dev-echo`) modes. Using it directly as the default
 * transport means the app performs real (or dev-echo/refuse) delivery out of
 * the box, while `makeApp` still accepts a `transport` override so tests can
 * inject a deterministic mock without touching the routes.
 */
const defaultTransport = require('./lib/email');

/**
 * Build an isolated Express app instance.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath]    Explicit SQLite file path, or ':memory:'.
 *                                     Defaults to `<dataDir>/applications.db`.
 * @param {string} [options.dataDir]   Directory for uploads (and the default
 *                                     db location). Defaults to REU_DATA_DIR or
 *                                     `<__dirname>/data`.
 * @param {object} [options.transport] Email_Service transport. Must expose
 *                                     `sendVerificationCode(email, code)`.
 * @param {string} [options.adminToken] Admin bearer token for this instance.
 * @param {boolean} [options.devEcho]  Echo verification codes in API responses.
 * @param {boolean} [options.showcaseEnabled] Enable the participant showcase
 *                                     (Req 19). Defaults to SHOWCASE_ENABLED=1.
 * @returns {import('express').Express} The configured Express app. Its
 *   `locals` expose `db`, `DATA_DIR`, `UPLOAD_DIR`, and `ADMIN_TOKEN`.
 */
function makeApp(options = {}) {
  // Data directory is configurable so tests can drive the app against a
  // throwaway SQLite file / upload dir without touching production data.
  const DATA_DIR = options.dataDir
    ? path.resolve(options.dataDir)
    : (process.env.REU_DATA_DIR ? path.resolve(process.env.REU_DATA_DIR) : path.join(__dirname, 'data'));
  const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const dbPath = options.dbPath || path.join(DATA_DIR, 'applications.db');
  // Requirement 20.3: a production deployment MUST run with a configured admin
  // token. When NODE_ENV === 'production' and no token is supplied (neither an
  // explicit `options.adminToken` nor `process.env.ADMIN_TOKEN`), refuse to
  // start rather than silently generating a random token that would rotate on
  // every restart and lock staff out. Tests always pass an explicit adminToken,
  // so this only gates the default/standalone startup path.
  const providedAdminToken = options.adminToken || process.env.ADMIN_TOKEN;
  if (process.env.NODE_ENV === 'production' && !providedAdminToken) {
    throw new Error(
      'ADMIN_TOKEN is required in production. Set the ADMIN_TOKEN environment variable before starting the server.'
    );
  }
  const ADMIN_TOKEN = providedAdminToken || crypto.randomBytes(16).toString('hex');
  const devEcho = options.devEcho != null ? options.devEcho : (process.env.DEV_ECHO_CODES === '1');

  // Requirement 20.3: verification codes must NEVER appear in API responses in
  // production. Even when dev-echo is enabled (DEV_ECHO_CODES=1 / devEcho), a
  // production environment hard-gates the code off. This is evaluated per
  // request so the guard always reflects the live NODE_ENV.
  function exposeDevCode() {
    return devEcho && process.env.NODE_ENV !== 'production';
  }
  const transport = options.transport || defaultTransport;

  // Requirement 19: the participant Showcase_Section is feature-flagged OFF by
  // default. `options.showcaseEnabled` lets tests drive an isolated instance;
  // otherwise the flag comes from SHOWCASE_ENABLED=1. Even when enabled, the
  // showcase only exposes data when curated cohort data is actually present
  // (Req 19.4), which is enforced by `buildShowcase` at request time.
  const showcaseEnabled = options.showcaseEnabled != null
    ? Boolean(options.showcaseEnabled)
    : (process.env.SHOWCASE_ENABLED === '1');
  // Curated cohort data source. This is a SEPARATE dataset from the
  // `applications` intake table (which holds internal-review fields); it is
  // empty by default so the showcase renders "forthcoming" until a cohort is
  // published. Reading a fresh copy per request keeps the flag/data honest
  // without a restart. A missing/malformed file is treated as no cohort.
  const SHOWCASE_FILE = path.join(DATA_DIR, 'showcase.json');
  function loadCohort() {
    try {
      const parsed = JSON.parse(fs.readFileSync(SHOWCASE_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.participants)) return parsed.participants;
      return [];
    } catch (_e) {
      return []; // no file / invalid JSON -> forthcoming
    }
  }

  // ---------- abuse / rate-limit configuration (defense in depth) ----------
  // App-level rate limiting on the sensitive write endpoints (account
  // register/verify/login/resend and application submission). This is a SECOND
  // layer behind the edge protection (reverse proxy / WAF / DDoS mitigation)
  // that should front the CRC deployment — see DEPLOY.md "Abuse protection".
  //
  // Enabled by default in production (or when RATE_LIMIT_ENABLED=1) and OFF in
  // dev/test unless explicitly enabled, so the fast property-based suite is not
  // throttled. `options.rateLimit` overrides everything for isolated tests.
  const rlOpt = options.rateLimit || {};
  const rateLimitEnabled = rlOpt.enabled != null
    ? Boolean(rlOpt.enabled)
    : (process.env.RATE_LIMIT_ENABLED === '1'
        || (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_ENABLED !== '0'));
  const rlNum = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const rlAuth = rlOpt.auth || {};
  const rlApply = rlOpt.apply || {};
  const AUTH_RATE_MAX = rlNum(rlAuth.max != null ? rlAuth.max : process.env.AUTH_RATE_MAX, 30);
  const AUTH_RATE_EMAIL_MAX = rlNum(rlAuth.emailMax != null ? rlAuth.emailMax : process.env.AUTH_RATE_EMAIL_MAX, 6);
  const AUTH_RATE_WINDOW_MS = rlNum(rlAuth.windowMs != null ? rlAuth.windowMs : process.env.AUTH_RATE_WINDOW_MS, 15 * 60 * 1000);
  const APPLY_RATE_MAX = rlNum(rlApply.max != null ? rlApply.max : process.env.APPLY_RATE_MAX, 8);
  const APPLY_RATE_WINDOW_MS = rlNum(rlApply.windowMs != null ? rlApply.windowMs : process.env.APPLY_RATE_WINDOW_MS, 60 * 60 * 1000);

  // ---------- database ----------
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      affiliation TEXT NOT NULL CHECK (affiliation IN ('ualr','external')),
      verified INTEGER NOT NULL DEFAULT 0,
      verify_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      confirmation TEXT UNIQUE NOT NULL,
      submitted_at TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      affiliation TEXT NOT NULL,
      citizenship TEXT NOT NULL,
      institution TEXT NOT NULL,
      institution_type TEXT NOT NULL,
      major TEXT NOT NULL,
      year TEXT NOT NULL,
      theme1 TEXT NOT NULL,
      theme2 TEXT,
      statement TEXT NOT NULL,
      ref1_name TEXT NOT NULL,
      ref1_email TEXT NOT NULL,
      ref2_name TEXT NOT NULL,
      ref2_email TEXT NOT NULL,
      first_gen TEXT,
      veteran TEXT,
      outreach TEXT,
      transcript_file TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received'
    );
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // ---------- upload handling ----------
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) =>
        cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '.pdf'),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) =>
      file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Transcript must be a PDF')),
  });

  const app = express();
  // Behind the CRC reverse proxy, honor X-Forwarded-* so req.ip reflects the
  // real client (needed for correct rate-limit keying). Off by default so a
  // direct/dev deployment does not blindly trust forwarding headers. Set
  // TRUST_PROXY=true (or a specific hop count / subnet) in production.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
  }
  // Expose internals so tests (supertest) can inspect/clean up without a live port.
  app.locals.db = db;
  app.locals.rateLimitEnabled = rateLimitEnabled;
  app.locals.DATA_DIR = DATA_DIR;
  app.locals.UPLOAD_DIR = UPLOAD_DIR;
  app.locals.ADMIN_TOKEN = ADMIN_TOKEN;
  app.locals.transport = transport;
  app.locals.SHOWCASE_ENABLED = showcaseEnabled;
  app.locals.SHOWCASE_FILE = SHOWCASE_FILE;
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  // ---------- per-app helpers ----------
  // Record every required-email attempt so a delivery failure is auditable and
  // the requesting operation can be reported truthfully (Req 13.3). The `error`
  // column holds internal detail for staff only; it is never returned to the
  // applicant.
  function logEmail(toEmail, kind, status, error) {
    try {
      db.prepare(
        `INSERT INTO email_log (to_email, kind, status, error, created_at)
         VALUES (?,?,?,?,?)`
      ).run(toEmail, kind, status, error == null ? null : String(error), new Date().toISOString());
    } catch (_e) {
      // Logging must never mask the actual operation result.
    }
  }

  // Map a transport resolution to an email_log status. The real Email_Service
  // resolves with `{status:'sent'|'dev-echo'}`; injected mock transports may
  // resolve with `undefined`, which we treat as a successful send.
  function deliveryStatus(result) {
    return (result && result.status) || 'sent';
  }

  // Promise-based wrappers around the injected transport. `Promise.resolve()
  // .then(...)` normalizes three transport shapes into one: a Promise-returning
  // transport (real Email_Service), a synchronous no-op mock (returns
  // undefined), and a transport that throws synchronously (surfaced as a
  // rejection). A rejection is the single signal of a blocking delivery failure.
  function sendVerificationEmail(email, code) {
    return Promise.resolve().then(() => transport.sendVerificationCode(email, code));
  }

  // Some injected mock transports only implement `sendVerificationCode`; guard
  // the confirmation call so a missing method resolves (no attempt made) rather
  // than throwing.
  function sendConfirmationEmail(email, confirmationNumber) {
    if (typeof transport.sendConfirmation !== 'function') {
      return Promise.resolve({ status: 'skipped' });
    }
    return Promise.resolve().then(() => transport.sendConfirmation(email, confirmationNumber));
  }

  function createSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
      .run(token, userId, expires.toISOString());
    res.cookie('session', token, {
      httpOnly: true, sameSite: 'lax', expires,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  function currentUser(req) {
    const token = req.cookies.session;
    if (!token) return null;
    const row = db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    ).get(token, new Date().toISOString());
    return row || null;
  }

  function requireUser(req, res, next) {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Sign in required' });
    req.user = u;
    next();
  }

  function requireAdmin(req, res, next) {
    if ((req.headers.authorization || '') === 'Bearer ' + ADMIN_TOKEN) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  // ---------- rate limiting (bot / abuse / DDoS hardening) ----------
  // A minimal in-memory sliding-window limiter. Keys are arbitrary strings
  // (e.g. "ip:1.2.3.4" or "em:a@b.edu"); each key tracks the timestamps of its
  // recent hits within `windowMs`. `over(key)` records a hit and returns true
  // when the key is now OVER `max`. This is the app-level complement to the
  // edge WAF/reverse-proxy; it is not a substitute for it (see DEPLOY.md).
  function makeLimiter(windowMs, max) {
    const hits = new Map();
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [k, arr] of hits) {
        const live = arr.filter((t) => now - t < windowMs);
        if (live.length) hits.set(k, live); else hits.delete(k);
      }
    }, windowMs);
    if (timer.unref) timer.unref();
    return {
      over(key) {
        const now = Date.now();
        const live = (hits.get(key) || []).filter((t) => now - t < windowMs);
        live.push(now);
        hits.set(key, live);
        return live.length > max;
      },
    };
  }

  const ipOf = (req) => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

  // Instantiated only when enabled so the disabled path allocates nothing.
  const authIpLimiter = rateLimitEnabled ? makeLimiter(AUTH_RATE_WINDOW_MS, AUTH_RATE_MAX) : null;
  const authEmailLimiter = rateLimitEnabled ? makeLimiter(AUTH_RATE_WINDOW_MS, AUTH_RATE_EMAIL_MAX) : null;
  const applyIpLimiter = rateLimitEnabled ? makeLimiter(APPLY_RATE_WINDOW_MS, APPLY_RATE_MAX) : null;

  // Auth-cluster limiter: caps attempts per client IP and, when an email is in
  // the body, per target email — so neither a single host nor a single targeted
  // account can be flooded (registration abuse, credential stuffing, code
  // guessing). Fails closed (429) if the check itself throws (cf. Req 16.5).
  function authRateLimit(req, res, next) {
    if (!rateLimitEnabled) return next();
    try {
      const email = clean(req.body && req.body.email).toLowerCase();
      if (authIpLimiter.over('ip:' + ipOf(req))) return res.status(429).json({ error: TOO_MANY });
      if (email && authEmailLimiter.over('em:' + email)) return res.status(429).json({ error: TOO_MANY });
    } catch (e) {
      console.error('[rate-limit] auth check failed:', e.message);
      return res.status(429).json({ error: TOO_MANY });
    }
    next();
  }

  // Application-submission limiter: caps submissions per authenticated user and
  // per client IP. Mounted AFTER requireUser so req.user is available.
  function applyRateLimit(req, res, next) {
    if (!rateLimitEnabled) return next();
    try {
      const uid = req.user ? req.user.id : 'anon';
      if (applyIpLimiter.over('ip:' + ipOf(req)) || applyIpLimiter.over('uid:' + uid))
        return res.status(429).json({ error: TOO_MANY });
    } catch (e) {
      console.error('[rate-limit] apply check failed:', e.message);
      return res.status(429).json({ error: TOO_MANY });
    }
    next();
  }

  // ---------- auth routes ----------
  app.post('/api/auth/register', authRateLimit, async (req, res) => {
    const email = clean(req.body.email).toLowerCase();
    const name = clean(req.body.name);
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    // Applicant-eligibility gate: accounts require an educational (.edu) email.
    if (!isEduEmail(email))
      return res.status(400).json({ error: 'Please use your school email address ending in .edu.' });
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (password.length < 10)
      return res.status(400).json({ error: 'Password must be at least 10 characters' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });

    const code = String(crypto.randomInt(100000, 1000000));
    const affiliation = affiliationOf(email);

    // Requirement 13.3: the verification email is a required message. Attempt
    // delivery BEFORE persisting the account/session so a failed send never
    // leaves a misleading "success" response (or an orphaned, unverifiable
    // account the applicant cannot re-register). On failure we record the
    // attempt and return a generic error with no internal detail.
    try {
      const result = await sendVerificationEmail(email, code);
      logEmail(email, 'verification', deliveryStatus(result));
    } catch (err) {
      logEmail(email, 'verification', 'failed', err && err.message);
      return res.status(502).json({
        error: 'We could not send your verification email right now. Please try again shortly.',
      });
    }

    const info = db.prepare(
      `INSERT INTO users (email, password_hash, name, affiliation, verify_code, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(email, bcrypt.hashSync(password, 12), name, affiliation, code, new Date().toISOString());

    createSession(res, info.lastInsertRowid);
    res.status(201).json({
      email, affiliation, verified: false,
      message: 'Check your email for a 6 digit verification code.',
      ...(exposeDevCode() ? { devCode: code } : {}),
    });
  });

  app.post('/api/auth/verify', authRateLimit, requireUser, (req, res) => {
    const code = clean(String(req.body.code == null ? '' : req.body.code), 10);
    if (req.user.verified) return res.json({ verified: true });
    if (!code || code !== req.user.verify_code)
      return res.status(400).json({ error: 'That code is not correct. Check the most recent email.' });
    db.prepare('UPDATE users SET verified = 1, verify_code = NULL WHERE id = ?').run(req.user.id);
    res.json({ verified: true });
  });

  app.post('/api/auth/resend', authRateLimit, requireUser, async (req, res) => {
    if (req.user.verified) return res.json({ verified: true });
    const code = String(crypto.randomInt(100000, 1000000));

    // Requirement 13.3: attempt delivery of the new code BEFORE persisting it,
    // so a failed send is blocking (no success response) and leaves the prior
    // code valid rather than replacing it with one the applicant never got.
    try {
      const result = await sendVerificationEmail(req.user.email, code);
      logEmail(req.user.email, 'verification', deliveryStatus(result));
    } catch (err) {
      logEmail(req.user.email, 'verification', 'failed', err && err.message);
      return res.status(502).json({
        error: 'We could not send your verification email right now. Please try again shortly.',
      });
    }

    db.prepare('UPDATE users SET verify_code = ? WHERE id = ?').run(code, req.user.id);
    res.json({ message: 'A new code was sent.', ...(exposeDevCode() ? { devCode: code } : {}) });
  });

  app.post('/api/auth/login', authRateLimit, (req, res) => {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || '');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !bcrypt.compareSync(password, u.password_hash))
      return res.status(401).json({ error: 'Email or password is incorrect' });
    createSession(res, u.id);
    res.json({ email: u.email, name: u.name, affiliation: u.affiliation, verified: !!u.verified });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.cookies.session)
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.session);
    res.clearCookie('session');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    const appRow = db.prepare(
      'SELECT confirmation, submitted_at, status FROM applications WHERE user_id = ?'
    ).get(u.id);
    res.json({
      email: u.email, name: u.name, affiliation: u.affiliation,
      verified: !!u.verified, application: appRow || null,
    });
  });

  /* Campus SSO mount point (disabled).
     UA Little Rock accounts live in Microsoft 365 / Azure AD. To enable:
     1. Register an app in the university Azure tenant (redirect: /auth/sso/callback).
     2. npm install openid-client, configure issuer https://login.microsoftonline.com/<tenant>/v2.0
     3. On callback, read the verified email claim; find-or-create the user with
        affiliation 'ualr' and verified = 1 (the IdP proved the mailbox); createSession().
     External students keep password auth. */
  app.get('/auth/sso', (req, res) =>
    res.status(501).json({ error: 'Campus SSO not configured. See server.js for integration notes.' }));

  // ---------- application routes ----------
  app.post('/api/applications', requireUser, applyRateLimit, (req, res) => {
    upload.single('transcript')(req, res, async (uploadErr) => {
      const fail = (code, msg) => {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(code).json({ error: msg });
      };
      if (uploadErr) return fail(400, uploadErr.message);
      if (!req.user.verified)
        return fail(403, 'Please verify your email before submitting (Account page).');

      const b = req.body || {};
      if (clean(b.website)) return fail(400, 'Submission rejected'); // honeypot
      if (!req.file) return fail(400, 'Transcript PDF is required');

      const errors = applicationFieldErrors(b);
      if (errors.length) return fail(400, errors.join('; '));

      if (db.prepare('SELECT confirmation FROM applications WHERE user_id = ?').get(req.user.id))
        return fail(409, 'You have already submitted an application this cycle. See your Account page.');

      const confirmation = 'REU27-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      db.prepare(`INSERT INTO applications (
          user_id, confirmation, submitted_at, first_name, last_name, email, phone,
          affiliation, citizenship, institution, institution_type, major, year,
          theme1, theme2, statement, ref1_name, ref1_email, ref2_name, ref2_email,
          first_gen, veteran, outreach, transcript_file
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          req.user.id, confirmation, new Date().toISOString(),
          clean(b.first_name), clean(b.last_name),
          req.user.email, clean(b.phone),           // email comes from the verified account
          req.user.affiliation, b.citizenship,
          clean(b.institution), clean(b.institution_type),
          clean(b.major), clean(b.year), clean(b.theme1), clean(b.theme2),
          clean(b.statement, 20000),
          clean(b.ref1_name), clean(b.ref1_email).toLowerCase(),
          clean(b.ref2_name), clean(b.ref2_email).toLowerCase(),
          clean(b.first_gen), clean(b.veteran), clean(b.outreach, 500),
          req.file.filename
        );

      console.log('[application] %s <%s> (%s) -> %s',
        clean(b.first_name), req.user.email, req.user.affiliation, confirmation);

      // Requirement 13.2/13.3: the confirmation email is a required message.
      // The application row is already persisted, so we never discard a valid
      // submission; but a delivery failure must not be reported as a plain
      // success. On failure we record the attempt and return a generic
      // non-success message that still surfaces the stored confirmation number
      // so the applicant retains it, without leaking internal error detail.
      try {
        const result = await sendConfirmationEmail(req.user.email, confirmation);
        if (deliveryStatus(result) !== 'skipped') {
          logEmail(req.user.email, 'confirmation', deliveryStatus(result));
        }
        res.status(201).json({ confirmation });
      } catch (err) {
        logEmail(req.user.email, 'confirmation', 'failed', err && err.message);
        res.status(502).json({
          confirmation,
          error:
            'Your application was recorded, but we could not send your confirmation email right now. ' +
            'Please keep your confirmation number for your records.',
        });
      }
    });
  });

  // ---------- admin routes ----------
  app.get('/api/admin/applications', requireAdmin, (req, res) => {
    const rows = db.prepare(
      `SELECT id, confirmation, submitted_at, first_name, last_name, email, affiliation,
              citizenship, institution, institution_type, year, theme1, status
       FROM applications ORDER BY submitted_at DESC`
    ).all();
    const internal = rows.filter((r) => r.affiliation === 'ualr').length;
    res.json({ count: rows.length, internal, external: rows.length - internal, applications: rows });
  });

  // Account sign-up statistics for the admin dashboard. Distinct from the
  // applications count: this reports how many applicant ACCOUNTS were created
  // (and how many verified their email), alongside the submitted-application
  // total and its internal/external split.
  app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const accounts = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const verified = db.prepare('SELECT COUNT(*) AS c FROM users WHERE verified = 1').get().c;
    const applications = db.prepare('SELECT COUNT(*) AS c FROM applications').get().c;
    const internal = db.prepare("SELECT COUNT(*) AS c FROM applications WHERE affiliation = 'ualr'").get().c;
    res.json({
      accounts,
      verified,
      unverified: accounts - verified,
      applications,
      internal,
      external: applications - internal,
    });
  });

  app.get('/api/admin/applications/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.get('/api/admin/transcript/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT transcript_file, confirmation FROM applications WHERE id = ?')
      .get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.download(path.join(UPLOAD_DIR, row.transcript_file), 'transcript-' + row.confirmation + '.pdf');
  });

  app.get('/api/admin/applications.csv', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT * FROM applications ORDER BY submitted_at').all();
    if (!rows.length) return res.type('text/csv').send('');
    const csv = buildApplicationsCsv(rows);
    res.type('text/csv').attachment('reu-applications.csv').send(csv);
  });

  // ---------- chatbot route ----------
  // Simple in-memory, per-IP rate limiter: the chat endpoint calls a metered
  // upstream API, so we cap it. 20 messages per rolling 5 minutes per IP.
  const CHAT_WINDOW_MS = 5 * 60 * 1000;
  const CHAT_MAX = 20;
  const chatHits = new Map(); // ip -> number[] (timestamps)
  function chatRateLimited(ip) {
    const now = Date.now();
    const hits = (chatHits.get(ip) || []).filter((t) => now - t < CHAT_WINDOW_MS);
    hits.push(now);
    chatHits.set(ip, hits);
    return hits.length > CHAT_MAX;
  }
  // keep the map from growing unbounded
  setInterval(() => {
    const now = Date.now();
    for (const [ip, hits] of chatHits) {
      const live = hits.filter((t) => now - t < CHAT_WINDOW_MS);
      if (live.length) chatHits.set(ip, live);
      else chatHits.delete(ip);
    }
  }, CHAT_WINDOW_MS).unref();

  app.post('/api/chat', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    // Fail closed (Req 16.5): if the rate-limit check throws, reject rather than pass through.
    let limited;
    try {
      limited = chatRateLimited(ip);
    } catch (e) {
      console.error('[chat] rate-limit check failed:', e.message);
      limited = true;
    }
    if (limited)
      return res.status(429).json({ error: 'Too many messages. Please wait a minute and try again.' });

    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim()) return res.status(400).json({ error: 'A message is required' });

    try {
      const result = await chatbot.answer(message, body.history);
      res.json(result);
    } catch (e) {
      console.error('[chat] error:', e.message);
      res.status(500).json({ error: 'The assistant is unavailable right now. Please email reu@ualr.edu.' });
    }
  });

  // ---------- showcase route (Requirement 19) ----------
  // Read-only public projection of the cohort. Returns participant data ONLY
  // when the showcase is enabled AND curated cohort data is present; otherwise
  // a "forthcoming" empty state with no participant data. The projection
  // includes ONLY home institution and academic year and structurally excludes
  // every internal-review field (statement, references, contact, transcript).
  app.get('/api/showcase', (req, res) => {
    res.json(buildShowcase(showcaseEnabled, loadCohort()));
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // hourly session cleanup
  setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  }, 36e5).unref();

  return app;
}

// Default, environment-configured app. `require('./server')` returns this app
// (with `makeApp` attached) so existing callers and tests keep working.
//
// The production admin-token guard (Req 20.3) lives in `makeApp`: constructing
// the default app in production without a configured ADMIN_TOKEN throws. That
// is exactly what we want for the standalone startup path (`node server.js`),
// but the test suite also `require`s this module — sometimes with
// NODE_ENV=production and no env ADMIN_TOKEN — and then builds its own isolated
// apps via `makeApp({ adminToken })`. To avoid aborting those requires while
// still refusing to *start* without a token, we rethrow the guard error only
// when run directly; when merely required as a module we fall back to a
// generated-token default app that the tests do not use.
let app;
try {
  app = makeApp();
} catch (err) {
  if (require.main === module) throw err; // standalone start: refuse to start
  app = makeApp({ adminToken: crypto.randomBytes(16).toString('hex') });
}

// Start a listening server only when run directly (`node server.js` / `npm start`).
// When required as a module (e.g. by supertest in the test suite), export the
// Express app instead so tests can drive it without binding a port.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('REU site running on http://localhost:' + PORT);
    console.log('Admin token: ' + app.locals.ADMIN_TOKEN +
      (process.env.ADMIN_TOKEN ? ' (from env)' : ' (generated; set ADMIN_TOKEN to fix it)'));
    if (DEV_ECHO_CODES) console.log('DEV_ECHO_CODES=1: verification codes are echoed in API responses. NEVER use in production.');
  });
}

module.exports = app;
module.exports.makeApp = makeApp;
module.exports.defaultTransport = defaultTransport;
