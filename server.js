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
*/
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString('hex');
const DEV_ECHO_CODES = process.env.DEV_ECHO_CODES === '1'; // echo verify codes in API responses (dev only!)
const UALR_DOMAINS = ['ualr.edu', 'trojans.ualr.edu'];
const SESSION_DAYS = 14;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- database ----------
const db = new Database(path.join(DATA_DIR, 'applications.db'));
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
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CITIZENSHIP = ['us_citizen', 'us_national', 'permanent_resident', 'other'];
const clean = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const affiliationOf = (email) => {
  const domain = email.split('@')[1] || '';
  return UALR_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d)) ? 'ualr' : 'external';
};

function sendVerificationEmail(email, code) {
  // PRODUCTION HOOK: replace with nodemailer / SES / university relay.
  console.log('[verify] %s -> code %s', email, code);
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

// ---------- auth routes ----------
app.post('/api/auth/register', (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const name = clean(req.body.name);
  const password = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (password.length < 10)
    return res.status(400).json({ error: 'Password must be at least 10 characters' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });

  const code = String(crypto.randomInt(100000, 1000000));
  const affiliation = affiliationOf(email);
  const info = db.prepare(
    `INSERT INTO users (email, password_hash, name, affiliation, verify_code, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(email, bcrypt.hashSync(password, 12), name, affiliation, code, new Date().toISOString());

  sendVerificationEmail(email, code);
  createSession(res, info.lastInsertRowid);
  res.status(201).json({
    email, affiliation, verified: false,
    message: 'Check your email for a 6 digit verification code.',
    ...(DEV_ECHO_CODES ? { devCode: code } : {}),
  });
});

app.post('/api/auth/verify', requireUser, (req, res) => {
  const code = clean(String(req.body.code == null ? '' : req.body.code), 10);
  if (req.user.verified) return res.json({ verified: true });
  if (!code || code !== req.user.verify_code)
    return res.status(400).json({ error: 'That code is not correct. Check the most recent email.' });
  db.prepare('UPDATE users SET verified = 1, verify_code = NULL WHERE id = ?').run(req.user.id);
  res.json({ verified: true });
});

app.post('/api/auth/resend', requireUser, (req, res) => {
  if (req.user.verified) return res.json({ verified: true });
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('UPDATE users SET verify_code = ? WHERE id = ?').run(code, req.user.id);
  sendVerificationEmail(req.user.email, code);
  res.json({ message: 'A new code was sent.', ...(DEV_ECHO_CODES ? { devCode: code } : {}) });
});

app.post('/api/auth/login', (req, res) => {
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
app.post('/api/applications', requireUser, (req, res) => {
  upload.single('transcript')(req, res, (uploadErr) => {
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

    const errors = [];
    const need = (k, label) => { if (!clean(b[k])) errors.push(label + ' is required'); };
    need('first_name', 'First name'); need('last_name', 'Last name');
    need('institution', 'Institution'); need('institution_type', 'Institution type');
    need('major', 'Major'); need('year', 'Year'); need('theme1', 'First choice theme');
    need('ref1_name', 'Reference 1 name'); need('ref2_name', 'Reference 2 name');
    if (!EMAIL_RE.test(clean(b.ref1_email))) errors.push('Reference 1 email is invalid');
    if (!EMAIL_RE.test(clean(b.ref2_email))) errors.push('Reference 2 email is invalid');
    if (!CITIZENSHIP.includes(b.citizenship)) errors.push('Citizenship status is required');
    if (clean(b.statement, 20000).length < 1200)
      errors.push('Personal statement must be at least 300 words');
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
    res.status(201).json({ confirmation });
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
  const cols = Object.keys(rows[0]).filter((c) => c !== 'statement');
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [cols.join(',')]
    .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
    .join('\n');
  res.type('text/csv').attachment('reu-applications.csv').send(csv);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// hourly session cleanup
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}, 36e5).unref();

app.listen(PORT, () => {
  console.log('REU site running on http://localhost:' + PORT);
  console.log('Admin token: ' + ADMIN_TOKEN +
    (process.env.ADMIN_TOKEN ? ' (from env)' : ' (generated; set ADMIN_TOKEN to fix it)'));
  if (DEV_ECHO_CODES) console.log('DEV_ECHO_CODES=1: verification codes are echoed in API responses. NEVER use in production.');
});
