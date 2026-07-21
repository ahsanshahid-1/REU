# Deploying the REU Site

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

1. **Email must work.** Right now verification codes only print to the server
   log. Open `server.js`, find `sendVerificationEmail()`, and wire it to a real
   sender (nodemailer + the campus SMTP relay, or SendGrid/SES). Without this,
   applicants cannot verify and cannot submit.
2. **Set a strong `ADMIN_TOKEN`** and never enable `DEV_ECHO_CODES`.
3. **Fill remaining placeholders** (PI name, real contact email — `reu@ualr.edu`
   must actually be created by UALR IT).
4. **Custom domain.** Point a subdomain at the host. For production this should
   be a `ualr.edu` subdomain (ask campus IT), which also builds applicant trust.
5. **Back up `data/`** on a schedule. It holds applicant PII.

---

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
