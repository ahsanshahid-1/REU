# Setup Guide

## 1. Run it locally (2 minutes)

Requirements: Node.js 18+.

```bash
cd reu-site
npm install
ADMIN_TOKEN=choose-a-long-secret DEV_ECHO_CODES=1 npm start
```

Open http://localhost:3000. Create an account (any email), open the browser
console to see the dev verification code (also printed in the server
terminal), verify, and submit a test application. Review it at
http://localhost:3000/admin.html with your ADMIN_TOKEN.

## 2. The database: how it works

**You already have one.** The app uses SQLite via better-sqlite3. On first
start it creates `data/applications.db` (all tables auto-created from the
schema in server.js) and `data/uploads/` for transcript PDFs. There is no
server to install, no connection string, no credentials. For a program
receiving hundreds of applications per cycle, SQLite is genuinely
sufficient and is the recommended starting point.

Backup = copy the `data/` folder. Inspect it with any SQLite browser
(e.g., `sqlite3 data/applications.db "SELECT * FROM applications;"` or the
DB Browser for SQLite GUI).

## 3. Deploying (so applicants can reach it)

Any host that runs a Node process works. The one requirement for SQLite is a
**persistent disk** so `data/` survives restarts.

**Render (simplest path):**
1. Push the project to a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command `npm install`, start command `npm start`.
4. Add a Disk (e.g., 1 GB) mounted at `/opt/render/project/src/data`.
5. Environment variables: `ADMIN_TOKEN` (long random string),
   `NODE_ENV=production`. Do NOT set `DEV_ECHO_CODES` in production.
6. Point a subdomain (e.g., reu.youralias.com now, and later a ualr.edu
   subdomain via UALR IT) at the service. HTTPS is automatic.

Railway and Fly.io work the same way (both offer volumes). A plain
university VM also works: `git clone`, `npm install`, run under systemd or
pm2 behind nginx with a Let's Encrypt certificate.

## 4. Moving to PostgreSQL (when IT asks for it)

Universities often require a managed database for systems holding student
data. `schema.postgres.sql` in this folder is the ready-to-run Postgres
schema.

Steps:
1. Provision Postgres (campus IT, or Render/Railway/Neon managed Postgres).
2. `psql "$DATABASE_URL" -f schema.postgres.sql`
3. In the app: `npm install pg`, and in server.js replace the better-sqlite3
   calls with pg. The changes are mechanical and localized:
   - `db.prepare(sql).get(...)`  → `await pool.query(sql, [...])` (first row)
   - `db.prepare(sql).all(...)`  → `await pool.query(sql, [...])` (all rows)
   - `db.prepare(sql).run(...)`  → `await pool.query(sql, [...])`
   - placeholders change from `?` to `$1, $2, ...`
   - route handlers become `async`
4. Transcripts stay on disk; for multi-server setups move them to S3-style
   object storage (the write happens in one place: the multer destination).

To migrate existing rows: `sqlite3 data/applications.db .dump`, adjust the
INSERTs (or use pgloader, which automates SQLite → Postgres).

## 5. Production checklist

- [ ] Replace every [bracketed placeholder] in index.html, apply.html,
      account.html (PI name, contact email, research areas, dates).
- [ ] Set a strong `ADMIN_TOKEN`; never enable `DEV_ECHO_CODES`.
- [ ] Wire real email in `sendVerificationEmail()` in server.js
      (nodemailer + the UALR SMTP relay, or SES/SendGrid). The same hook
      pattern applies for the submission-confirmation email.
- [ ] HTTPS only (any of the hosts above provide it automatically).
- [ ] Schedule backups of `data/` (contains applicant personal data;
      restrict access and set a retention policy with your IRB/registrar
      guidance).
- [ ] Ask UALR IT for a ualr.edu subdomain and, when ready, the Azure AD
      app registration for campus SSO (mount point: /auth/sso in server.js).
- [ ] After award: furnish the site URL to the cognizant NSF program
      officer within 90 days, per the solicitation.
