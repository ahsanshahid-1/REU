# Deploying the REU Site

> **Current status: applications are handled by NSF ETAP** (https://etap.nsf.gov).
> The site is informational and routes applicants to ETAP; the on-site
> application form and applicant accounts were removed. This means the live site
> is effectively **static pages + the `/api/chat` assistant** — it no longer
> needs to collect applicant PII on-site. The database/login backend below still
> exists in the code but is not used by the UI. Program/application dates are
> shown as **tentative and subject to change**.

## Updating the live CRC deployment (reu.crc.ualr.edu)

On the CRC JupyterHub container the site is served in **two places**, which is
the common gotcha:

1. **Apache** serves the static HTML from its DocumentRoot **`/var/www/reu`**
   (this is what the browser loads). See `deploy/crc-apache-proxy-request.md`.
2. **Node** (`server.js`) on `:3000` serves `/api/*` (the assistant + health);
   Apache proxies `/api` to it.

Because Apache's DocumentRoot is a **separate copy** from `~/reu/public`, a
`git pull` alone does **not** change what visitors see. Publish the pages too:

```bash
cd ~/reu
bash deploy.sh            # git pull + copy public/ into /var/www/reu
bash deploy.sh --restart  # also restart the Node app (needed for /api or chatbot changes)
```

Equivalent manual steps:

```bash
cd ~/reu && git pull
cp -a ~/reu/public/. /var/www/reu/                     # publish static pages Apache serves
# only if server.js / lib/ changed (e.g. the chatbot):
pkill -f "node server.js"; sleep 1
ADMIN_TOKEN="$ADMIN_TOKEN" setsid nohup npm start > ~/reu/server.log 2>&1 &
```

The Node process runs inside the singleuser container, so it stops if the
container is culled/restarted; re-run the start command (or `deploy.sh
--restart`) to bring it back. Then hard-refresh the browser (Cmd/Ctrl+Shift+R),
since `*.html` is not cache-busted.

## The one thing to understand first

This site is **not just static HTML**. It runs a Node server with a database,
file uploads, and login. That means:

- **GitHub Pages / Netlify / Vercel static hosting will NOT run it.** They
  serve files only; there is no place for the server, database, or uploads.
- You need a host that runs a **live Node process with a persistent disk**.

GitHub still has a role: it stores your code and is what the good hosts deploy
FROM. So you push to GitHub, then connect a host to that repo.

Because this collects student names, emails, and transcripts for a federally
funded university program, read "Production at UALR" below before going live
for real. The quick path is fine for a demo to your PI or NSF reviewers.

---

## Step 1 — Put the code on GitHub (once)

```bash
cd reu-site
git init
git add .
git commit -m "REU recruitment site"
```

Create an empty repo on github.com (private is fine and recommended), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/reu-site.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `data/`, and `.env`, so no
secrets or applicant data are ever committed.

---

## Step 2 — Deploy (pick ONE)

### Option A — Render (easiest, ~$7/month for always-on)

1. Sign up at render.com and connect your GitHub.
2. New > Blueprint, choose your repo. It reads `render.yaml` and provisions
   the web service + a 1 GB persistent disk automatically.
3. When it finishes you get a URL like `https://reu-site.onrender.com`.
4. In the dashboard, open the service > Environment, and copy the generated
   `ADMIN_TOKEN` value somewhere safe (that is your admin login).

Notes on Render's free tier: it exists, but it has **no persistent disk** and
**sleeps after 15 minutes**, so uploaded transcripts and the database would be
lost on restart. Use the `starter` plan (set in render.yaml) for anything real.
HTTPS is automatic on every plan.

### Option B — Railway (similar, usage-based)

1. railway.app > New Project > Deploy from GitHub repo.
2. Add a Volume mounted at `/app/data`.
3. Set variables: `NODE_ENV=production`, `ADMIN_TOKEN=<long random string>`.
4. Railway detects Node and runs `npm install` + `node server.js`.

### Option C — Any server with Docker (universities often prefer this)

A `Dockerfile` is included, so any Docker host runs it identically:

```bash
docker build -t reu-site .
docker run -d -p 3000:3000 \
  -e ADMIN_TOKEN="a-long-random-string" \
  -e NODE_ENV=production \
  -v /srv/reu-data:/app/data \
  --name reu-site reu-site
```

The `-v` line is the important part: it keeps the database and transcripts on
the host disk so they survive restarts and redeploys. Put nginx or Caddy in
front for HTTPS.

---

## Step 3 — Before real applicants use it

1. **Email must work.** The Email_Service (`lib/email.js`) sends verification
   codes and submission confirmations via nodemailer, configured from the
   environment. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
   `SMTP_PASS`, and `MAIL_FROM` (campus SMTP relay, or SendGrid/SES). Without a
   configured transport a required send fails by design (fail-safe), so
   applicants cannot verify or submit — dev-echo (`DEV_ECHO_CODES=1`) is for
   local testing only and must never be set in production. See SETUP.md §3a.
2. **Set a strong `ADMIN_TOKEN`** and never enable `DEV_ECHO_CODES`.
3. **Fill remaining placeholders** (PI name, real contact email — `reu@ualr.edu`
   must actually be created by UALR IT).
4. **Custom domain.** Point a subdomain at the host. For production this should
   be a `ualr.edu` subdomain (ask campus IT), which also builds applicant trust.
5. **Back up `data/`** on a schedule. It holds applicant PII.

---

## Operational requirements (start command, health, HTTPS, NSF URL)

These four items satisfy the deployment obligations for the award. They are
short but not optional.

### Single start command + health check (Req 20.1)

The whole service starts from one command — no build step, no process manager
required to boot it:

```bash
npm start          # equivalent to: node server.js
```

It listens on `PORT` (default `3000`). On first start it self-provisions the
SQLite database and `data/uploads/`, so the same command works on a fresh host.

Liveness is reported by a health endpoint:

```bash
curl https://YOUR-HOST/api/health      # -> {"ok":true}
```

Point your host's health check (Render/Railway/Fly all have one) or your
uptime monitor at `GET /api/health`. A `200 {"ok":true}` means the process is
up and serving.

### HTTPS in production (Req 20.4)

**Any publicly reachable deployment must be served over HTTPS — no exceptions.**
The site collects names, emails, and transcripts, so plaintext HTTP is not
acceptable for a live deployment. In practice:

- On Render/Railway/Fly, TLS is terminated for you automatically on every plan
  (the `render.yaml` blueprint deploys behind their HTTPS edge). You do not
  configure certificates.
- On a self-managed VM / Docker host, put nginx or Caddy in front and obtain a
  Let's Encrypt certificate; do not expose `node server.js` directly on `:80`.
- **This ties to a real behavior in the app:** the session cookie is only
  marked `Secure` when `NODE_ENV=production` (see `createSession` in
  server.js). So production must (a) be served over HTTPS *and* (b) run with
  `NODE_ENV=production`, or the login cookie will be sent over an insecure
  connection. Set both together.

### Furnishing the site URL to NSF (Req 20.5)

NSF requires REU Site awardees to make the program's public URL available to
the cognizant NSF program officer, and to have the site reachable, **within 90
days of the award notification**. Concrete procedure once the award is issued:

1. **Stand up the production deployment** (HTTPS, `NODE_ENV=production`,
   configured SMTP, strong `ADMIN_TOKEN`) at its final address — ideally a
   `ualr.edu` subdomain via UALR IT. Confirm it is live with
   `curl https://<url>/api/health`.
2. **Identify the cognizant program officer** — the PO named in the award
   notification / on the Fastlane/Research.gov award record for this REU Site.
3. **Send the URL to that PO by email** from the PI, referencing the award
   number, stating the public site URL, and confirming the recruitment site is
   live and accepting applications. Copy the sponsored-programs office.
4. **Do this within 90 days of the award notification date** (calendar a
   reminder for ~day 60 as a buffer). Keep the sent email in the award file as
   evidence the obligation was met.
5. If the final `ualr.edu` domain is not ready inside the window, furnish the
   working interim URL (e.g., the Render URL) on time and send the PO the
   updated address once the campus domain goes live.

---

## Abuse protection (bots, floods, DDoS)

Because the site is publicly reachable at `reu.crc.ualr.edu` (no VPN), it needs
protection against automated abuse. This is handled in **two layers** — do not
rely on only one.

### Layer 1 — the edge (reverse proxy / WAF), where DDoS is actually stopped

Volumetric floods and DDoS must be absorbed at the edge, before traffic reaches
the Node process. Put the app behind the CRC reverse proxy and configure:

- **Reverse proxy in front (nginx/Caddy or the CRC ingress).** Terminate TLS,
  cap request body size, set sane connection/read timeouts, and forward the
  real client IP. Then set `TRUST_PROXY=true` so the app keys its own rate
  limits on the real IP rather than the proxy's.
- **Connection / request rate limiting at the proxy** (e.g. nginx
  `limit_req` / `limit_conn`) as the first throttle.
- **A WAF / DDoS layer** where available (campus WAF, or a CDN/edge such as
  Cloudflare in front of the subdomain) for volumetric and L7 attack
  mitigation, bot filtering, and IP reputation. App code cannot stop a true
  DDoS; the edge does.
- **MFA / SSO** in front of the admin surface (and optionally the whole site),
  coordinated with UALR IT (Microsoft/Azure AD or the campus Google tenant).

### Layer 2 — the app (already built in)

Defense in depth inside the server, on by default in production:

- **Per-IP and per-email rate limiting** on the auth cluster
  (`/api/auth/register|verify|login|resend`) and **per-user/IP** limiting on
  application submission (`/api/applications`). Default allowances (each
  configurable — see `.env.example`):
  - **30 auth requests per IP** per 15-minute window (`AUTH_RATE_MAX`),
  - **6 auth requests per email** per 15-minute window (`AUTH_RATE_EMAIL_MAX`) —
    the tighter cap that stops targeted login/verification guessing,
  - **8 application submissions per user/IP** per hour (`APPLY_RATE_MAX`).

  Requests past a cap get **HTTP 429** with "Too many attempts. Please wait a
  few minutes and try again." The checks **fail closed** — if the limiter
  errors, the request is rejected rather than allowed through. Toggle the whole
  layer with `RATE_LIMIT_ENABLED` (on by default in production).
- **Per-IP rate limiting** on the chatbot (`/api/chat`), which calls a metered
  model API: **20 messages per IP** per rolling 5 minutes.
- **Honeypot field** on the application form (a filled hidden `website` field is
  rejected as spam).
- **`.edu`-only account registration** — a coarse eligibility gate that also
  cuts down on throwaway/bot signups.

For stronger bot resistance on the public forms (registration and the chat
widget), a **CAPTCHA / challenge** (hCaptcha, Cloudflare Turnstile, or reCAPTCHA)
can be added in front of `register` and `chat`. It is not wired in yet; add it
at the edge or as a token check on those two endpoints when abuse warrants.

## The database — how it works and how to move it

**Default (SQLite): nothing to set up.** On first start the app creates
`data/applications.db` with all tables, plus `data/uploads/` for transcripts.
Backing up = copying the `data/` folder. For a program taking a few hundred
applications a cycle, this is genuinely enough, and it is one less system to
secure.

**If UALR IT requires managed PostgreSQL** (common for student PII under a
federal award), the project ships `schema.postgres.sql` and `SETUP.md` walks
through the switch. Short version:
1. IT provisions Postgres and gives you a `DATABASE_URL`.
2. `psql "$DATABASE_URL" -f schema.postgres.sql`
3. `npm install pg`, and swap the better-sqlite3 calls for `pg` (the queries
   are the same SQL; placeholders change from `?` to `$1, $2, ...`).
Transcripts can stay on disk, or move to campus object storage for multi-server
setups.

---

## Production at UALR (the honest recommendation)

For a live program under an NSF award, student transcripts and personal data
should almost certainly live on **university-managed infrastructure** for FERPA
and IRB compliance, not a personal Render/Railway account. The realistic path:

- Use Render/Railway now to demo the working site to your PI and NSF reviewers.
- For production, hand this repo (it is a standard Node + Docker app) to UALR
  IT and ask them to host it on a campus server or their cloud tenant, with a
  `ualr.edu` subdomain, campus SMTP for email, and their preferred database.
  Everything they need is in this repo, DEPLOY.md, and SETUP.md.
- That same conversation is when you request campus SSO for @ualr.edu accounts
  (the `/auth/sso` mount point in server.js documents the integration).
