# NSF REU Site: Recruitment Website + Application Backend

A recruitment site for the **SURE-AI** NSF REU Site at UA Little Rock
(NSF 23-601) — a fully funded, eight-week summer program for a cohort of 10 in
efficient, secure, and trustworthy AI.

> **Applications are handled entirely through NSF ETAP** (https://etap.nsf.gov).
> The site is informational and routes every applicant to ETAP; it no longer
> collects applications on-site. The on-site application form and applicant
> account/login pages were removed (`apply.html` and `account.html` are now
> ETAP notice pages). The Express + SQLite backend (auth, application intake,
> admin review) remains in the codebase for reference but is **no longer wired
> to the UI**; the public pages do not call it. Program and application dates
> are shown as **tentative and subject to change** until confirmed.

It pairs the public recruitment pages with a light/dark theming system and a
retrieval-augmented assistant, plus the (now-unused) Express + SQLite backend.

## Run locally

### Prerequisites

- **Node.js 20 or newer** (Node 20 LTS or 22 LTS recommended). Required because
  `better-sqlite3@12` supports Node `20.x/22.x/23.x/24.x`. Check with `node -v`.
- **npm** (ships with Node).
- **A C/C++ build toolchain + Python 3**, needed *only if* `npm install` cannot
  download a prebuilt `better-sqlite3` binary for your platform and has to
  compile it from source:
  - macOS: `xcode-select --install`
  - Debian/Ubuntu: `sudo apt-get install -y build-essential python3`
  - Windows: install the "Desktop development with C++" workload (Visual Studio
    Build Tools). On common platforms a prebuilt binary is used and no toolchain
    is needed.

### Install dependencies

```bash
npm install
```

That single command downloads everything. Runtime dependencies:
`express`, `better-sqlite3`, `bcryptjs`, `cookie-parser`, `multer`, `nodemailer`.
Dev/test dependencies (installed too): `fast-check`, `supertest`,
`node-html-parser`. The test runner itself is Node's built-in `node:test` — no
extra install. No global tools are required.

### Start the server

```bash
ADMIN_TOKEN=choose-a-long-secret DEV_ECHO_CODES=1 npm start
# open http://localhost:3000
```

- Env vars are read from the **process environment** — there is no `dotenv`, so
  a `.env` file is NOT auto-loaded. Set variables inline (as above) or `export`
  them first. `npm start` runs `node server.js`.
- `ADMIN_TOKEN` — the admin/staff key for `/admin.html`. If unset, a random one
  is generated and printed at startup (it changes on every restart, so set it).
- `DEV_ECHO_CODES=1` — local only: surfaces the 6-digit email verification code
  in the API response and browser console so you can verify an account without
  configuring SMTP. Never set it in production.
- On first start the app auto-creates `data/applications.db` and `data/uploads/`
  (no database to install).

Quick check: `curl http://localhost:3000/api/health` returns `{"ok":true}`.

### Run the tests (optional)

```bash
npm test        # runs node --test over the test/ suite
```

## Structure

```
server.js               Express backend (form API, admin API, static serving)
public/index.html       Overview / landing page
public/research.html    Research: SURE-AI pathways, faculty, maps, badges, evaluation
public/eligibility.html Eligibility & funding
public/faq.html         Dates & FAQ
public/apply.html       Notice page → directs applicants to NSF ETAP (on-site form removed)
public/account.html     Notice page → directs applicants to NSF ETAP (accounts removed)
public/admin.html       Staff review panel (token protected)
public/styles/theme.css Semantic token theming system (light/dark, extensible)
public/styles/site.css  Components; consume ONLY tokens from theme.css
public/js/site.js       Progressive enhancement (theme toggle, menu, scroll spy)
data/applications.db    SQLite database (created on first run)
data/uploads/           Transcript PDFs (created on first run)
```

## Applicant accounts (auth) — retained but not used

> **Applicants no longer create an account here.** Applications go through NSF
> ETAP (https://etap.nsf.gov). The flow below describes the on-site backend that
> still exists in `server.js`/`lib/` but is no longer exposed in the UI. It is
> kept for reference and can be fully removed if you never plan to collect
> applications on-site.

The (unused) on-site flow required a verified applicant account. Affiliation is
derived from the email domain and verified by the email code:

- `@ualr.edu` / `@trojans.ualr.edu` → **ualr** (campus student)
- any other domain → **external**

Flow: register (email + password ≥ 10 chars, bcrypt hashed) → 6 digit code
emailed → verify → the application form unlocks. Sessions are 256-bit random
tokens in httpOnly cookies, stored server side in SQLite, 14 day expiry.
One application per account per cycle. The application's email always comes
from the verified account, never from the form.

The admin panel and CSV export report the internal/external split, which you
need for NSF's requirement that a significant fraction of participants come
from outside the host institution.

**Dev mode:** run with `DEV_ECHO_CODES=1` to have verification codes echoed
in API responses and the browser console (never in production). Codes are
always printed to the server log; the production email hook is
`sendVerificationEmail()` in server.js.

**Campus SSO:** UA Little Rock accounts live in Microsoft 365 / Azure AD.
The mount point `/auth/sso` in server.js documents the OIDC integration:
register an app in the university tenant, use `openid-client` against
`login.microsoftonline.com/<tenant>/v2.0`, and on callback mark the user
`affiliation='ualr', verified=1` since the IdP proved the mailbox. External
students keep password auth.

## API

> These endpoints still exist in `server.js`, but the applicant-facing ones
> (`/api/auth/*`, `/api/applications`) are **no longer called by the site** —
> applications are collected by NSF ETAP. `/api/chat` (assistant) and
> `/api/health` are the endpoints the live UI still uses.

| Method | Path                            | Auth    | Purpose |
|--------|---------------------------------|---------|---------|
| POST   | /api/auth/register              | none    | Create account, starts session, emails code |
| POST   | /api/auth/verify                | session | Confirm 6 digit code |
| POST   | /api/auth/resend                | session | Re-send code |
| POST   | /api/auth/login                 | none    | Sign in |
| POST   | /api/auth/logout                | session | Sign out |
| GET    | /api/auth/me                    | session | Account + application status |
| POST   | /api/applications               | session (verified) | Submit application (multipart, `transcript` PDF ≤ 5 MB) |
| GET    | /api/admin/applications         | Bearer | List applications |
| GET    | /api/admin/applications/:id     | Bearer | Full record incl. statement |
| GET    | /api/admin/transcript/:id       | Bearer | Download a transcript |
| GET    | /api/admin/applications.csv     | Bearer | CSV export (statement excluded) |
| GET    | /api/health                     | none   | Health check |

Server side protections: field validation mirroring the client, email format
checks, honeypot field, one application per email per cycle (409 on duplicate),
PDF-only uploads with size limit, input length caps.

## Theming system (UA Little Rock)

The palette is UA Little Rock maroon and silver in both modes. The previous
cobalt theme is kept at `public/styles/theme.cobalt.css.bak` as a reference
for how a full retheme touches exactly one file.


- Raw palette scales are private (`--_blue-700` etc.); semantic tokens
  (`--bg-surface`, `--fg-primary`, `--action-primary-bg`, …) are the only API.
- Mode resolution uses `color-scheme` + `light-dark()`, so the OS preference
  is honored with zero JavaScript on first paint.
- An explicit user choice is one class on `<html>`: `.light` or `.dark`.
  `site.js` persists it in localStorage and re-applies it.
- Add a theme later by adding one root class that overrides semantic tokens
  (stub included at the bottom of theme.css). No component changes needed.
- All shipped foreground/background pairings meet WCAG 2.1 AA; the verified
  ratios are documented in the header comment of theme.css.

## Before going live

1. Confirm every Apply CTA points to the program's **NSF ETAP** listing
   (https://etap.nsf.gov). Applications are collected there, not on this site.
2. Replace the PI name/contact placeholders where present, and update the
   **tentative** dates as they are confirmed (statusbar + hero on `index.html`,
   FAQ timeline on `faq.html`, and the `dates` chunk in `lib/knowledge.js`).
3. Set `ADMIN_TOKEN` and serve behind HTTPS (any reverse proxy or a host like
   Render, Railway, or Fly.io; the app is a single Node process). On the CRC
   container the site is served by Apache from a DocumentRoot (`/var/www/reu`)
   with `/api` proxied to Node — see DEPLOY.md and `deploy.sh`.
4. The assistant (`/api/chat`) is the main live backend feature; verify it
   answers correctly after content changes.
5. NSF requirement: furnish the site URL to your cognizant NSF program officer
   within 90 days of award notification.
6. After the program starts, add a cohort page: participants, projects,
   symposium talks, posters, and publications.

> If you keep the (now-unused) on-site application backend, the earlier
> production notes still apply: strong `ADMIN_TOKEN`, real SMTP, and scheduled
> backups of `data/` (applicant PII). If you rely solely on ETAP, that backend
> can be left dormant or removed.
