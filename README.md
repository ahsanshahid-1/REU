# NSF REU Site: Recruitment Website + Application Backend

A complete recruitment site for an NSF REU Site (solicitation 23-601), with an
application form backed by Express + SQLite, transcript uploads, an admin
review panel, and a light/dark theming system.

## Run locally

```bash
npm install
ADMIN_TOKEN=choose-a-long-secret npm start
# open http://localhost:3000
```

If you do not set `ADMIN_TOKEN`, a random one is generated and printed at
startup (it changes on every restart, so set it for real use).

## Structure

```
server.js               Express backend (form API, admin API, static serving)
public/index.html       Main recruitment site
public/apply.html       Application form (validates client side and server side)
public/admin.html       Staff review panel (token protected)
public/styles/theme.css Semantic token theming system (light/dark, extensible)
public/styles/site.css  Components; consume ONLY tokens from theme.css
public/js/site.js       Progressive enhancement (theme toggle, menu, scroll spy)
data/applications.db    SQLite database (created on first run)
data/uploads/           Transcript PDFs (created on first run)
```

## Applicant accounts (auth)

Applying requires a verified applicant account. Affiliation is derived from
the email domain and verified by the email code:

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

1. Replace `[PI Name]`, phone, email, and dates in both HTML files.
2. Set `ADMIN_TOKEN` and serve behind HTTPS (any reverse proxy or a host like
   Render, Railway, or Fly.io; the app is a single Node process).
3. Wire confirmation email: the hook point is marked in `server.js` in the
   POST handler (`nodemailer`, SES, or your university relay).
4. Back up `data/` (database + uploads) on a schedule; it contains applicant
   personal data, so restrict access accordingly and add a retention policy.
5. NSF requirement: furnish the site URL to your cognizant NSF program officer
   within 90 days of award notification.
6. After the program starts, add a cohort page: participants, projects,
   symposium talks, posters, and publications.
