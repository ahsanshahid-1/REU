# Setup Guide

## 1. Run it locally (2 minutes)

**Prerequisites:**
- **Node.js 20+** (Node 20 or 22 LTS recommended — `better-sqlite3@12` requires
  Node 20.x/22.x/23.x/24.x). Verify with `node -v`.
- **npm** (bundled with Node).
- Only if `npm install` can't fetch a prebuilt `better-sqlite3` binary and must
  compile it: a C/C++ toolchain + Python 3 (`xcode-select --install` on macOS,
  `build-essential python3` on Debian/Ubuntu, VS Build Tools "Desktop
  development with C++" on Windows). On common platforms this is not needed.

```bash
cd reu-site
npm install                                   # installs runtime + test deps
ADMIN_TOKEN=choose-a-long-secret DEV_ECHO_CODES=1 npm start
```

`npm install` downloads all dependencies: runtime (`express`, `better-sqlite3`,
`bcryptjs`, `cookie-parser`, `multer`, `nodemailer`) and test (`fast-check`,
`supertest`, `node-html-parser`); the test runner is Node's built-in
`node:test`.

Note: env vars are read from the process environment — there is **no `dotenv`**,
so a `.env` file is not auto-loaded. Pass variables inline (as above) or
`export` them in your shell first.

Open http://localhost:3000. The public pages (Overview, Research, Eligibility,
Dates & FAQ) route applicants to **NSF ETAP** (https://etap.nsf.gov) — the site
no longer collects applications on-site. Run the test suite with `npm test`.

> The on-site account/application backend still exists in the code but is not
> linked from the UI. If you want to exercise it locally for reference, POST
> directly to `/api/auth/*` and `/api/applications` (with `DEV_ECHO_CODES=1` to
> see verification codes), and review submissions at
> http://localhost:3000/admin.html with your `ADMIN_TOKEN`.

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

## 3a. Email (verification codes + submission confirmations)

Transactional email is delivered by the Email_Service (`lib/email.js`), a thin
nodemailer wrapper configured entirely from environment variables — no
credentials are hard-coded. It runs in one of three modes:

- **SMTP mode** — set `SMTP_HOST` (and the related vars below) and real mail is
  sent through that relay.
- **Dev-echo mode** — no `SMTP_HOST` plus `DEV_ECHO_CODES=1`: nothing is sent
  and the verification code is surfaced for local testing (the workflow in
  section 1). Never enable in production.
- **Fail-safe mode** — no `SMTP_HOST` and not dev-echo: a required send fails,
  so production can never silently report success without actually emailing.

Environment variables (see `.env.example`):

| Variable | Purpose | Example |
|----------|---------|---------|
| `SMTP_HOST` | SMTP server hostname (enables SMTP mode) | `smtp.example.edu` |
| `SMTP_PORT` | SMTP port | `587` (STARTTLS) or `465` (TLS) |
| `SMTP_SECURE` | Implicit TLS on connect | `true` for 465, `false` for 587/25 |
| `SMTP_USER` | SMTP auth username | `reu-mailer` |
| `SMTP_PASS` | SMTP auth password | (secret) |
| `MAIL_FROM` | `From:` header on outgoing mail | `UA Little Rock REU <reu@ualr.edu>` |

Every required-email attempt is recorded in the `email_log` table
(`to_email, kind, status, error, created_at`) so a delivery failure is
auditable; a failed required send blocks the operation that requested it and
never leaks internal error detail to the applicant.

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

- [ ] Confirm every Apply CTA links to the program's **NSF ETAP** listing
      (https://etap.nsf.gov); applications are collected there, not on-site.
      `apply.html` and `account.html` are ETAP notice pages.
- [ ] Update the **tentative** dates as they are confirmed (statusbar/hero in
      index.html, FAQ timeline in faq.html, and the `dates` chunk in
      lib/knowledge.js). Replace any PI name/contact placeholders where present.
- [ ] On the CRC container, publish static pages to Apache's DocumentRoot after
      each pull (`bash deploy.sh`) — a `git pull` alone does not update
      `/var/www/reu`. See DEPLOY.md.
- [ ] Set a strong `ADMIN_TOKEN`; never enable `DEV_ECHO_CODES`. (Only relevant
      if you keep the unused on-site application backend.)
- [ ] Configure real email: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
      `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` (UALR SMTP relay, or SES/
      SendGrid) so the Email_Service (`lib/email.js`) sends verification codes
      and submission confirmations. See section 3a.
- [ ] HTTPS only, and always paired with `NODE_ENV=production`. The hosts
      above terminate TLS automatically; the session cookie is only marked
      `Secure` when `NODE_ENV=production`, so set both together (Req 20.4).
- [ ] Confirm the service is up via its single start command (`npm start`,
      i.e. `node server.js`) and the health endpoint: `curl https://<url>/api/health`
      returns `{"ok":true}` (Req 20.1).
- [ ] Schedule backups of `data/` (contains applicant personal data;
      restrict access and set a retention policy with your IRB/registrar
      guidance).
- [ ] Ask UALR IT for a ualr.edu subdomain and, when ready, the Azure AD
      app registration for campus SSO (mount point: /auth/sso in server.js).
- [ ] After award: furnish the live site URL to the cognizant NSF program
      officer (the PO on the award notice) by email from the PI, citing the
      award number, **within 90 days of the award notification** — see the
      step-by-step procedure in DEPLOY.md ("Furnishing the site URL to NSF").
