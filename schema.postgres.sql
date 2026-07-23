-- PostgreSQL schema equivalent to the SQLite schema in server.js.
-- Use this when migrating off the default SQLite database.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  affiliation   TEXT NOT NULL CHECK (affiliation IN ('ualr','external')),
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  verify_code   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER UNIQUE NOT NULL REFERENCES users(id),
  confirmation     TEXT UNIQUE NOT NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT,
  affiliation      TEXT NOT NULL,
  citizenship      TEXT NOT NULL,
  institution      TEXT NOT NULL,
  institution_type TEXT NOT NULL,
  major            TEXT NOT NULL,
  year             TEXT NOT NULL,
  theme1           TEXT NOT NULL,
  theme2           TEXT,
  statement        TEXT NOT NULL,
  ref1_name        TEXT NOT NULL,
  ref1_email       TEXT NOT NULL,
  ref2_name        TEXT NOT NULL,
  ref2_email       TEXT NOT NULL,
  first_gen        TEXT,
  veteran          TEXT,
  outreach         TEXT,
  transcript_file  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received'
);

-- Records every required-email attempt (verification / confirmation) so a
-- delivery failure is auditable and the requesting operation can be reported
-- truthfully. Intentionally minimal: no message bodies or codes are stored.
CREATE TABLE IF NOT EXISTS email_log (
  id         SERIAL PRIMARY KEY,
  to_email   TEXT NOT NULL,
  kind       TEXT NOT NULL,               -- 'verification' | 'confirmation'
  status     TEXT NOT NULL,               -- 'sent' | 'failed' | 'dev-echo'
  error      TEXT,                         -- internal detail (never shown to applicant)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
