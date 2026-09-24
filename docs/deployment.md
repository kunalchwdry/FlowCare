# Deploying FlowCare to Vercel

Target: `vercel.com` + the existing Supabase project. Region is pinned to
**`bom1` (Mumbai)** in `vercel.json`, which is the closest Vercel region to
Pune and keeps the round trip to a Supabase `ap-south-1` project short.

---

## 1. Before the first push to GitHub

**Check what would be committed.** The repository contains things that must
never be pushed:

```bash
git status --short
git check-ignore -v .env.local backups/ .data/
```

`.gitignore` already excludes:

| Path | Why it must not be pushed |
|---|---|
| `.env.local` | Real Supabase URL, anon key, database password |
| `backups/` | **Full row dumps of the live database** — appointments, memberships, user ids |
| `.data/` | Local demo state |
| `scripts/.tmp/` | Throwaway SQL tooling |
| `.next/`, `.next-build/` | Build output |

Verify no key material is in tracked files before the first commit:

```bash
git add -A -n | awk '{print $2}' | tr -d '"' \
  | xargs -I{} grep -nEHI 'sb_publishable_[A-Za-z0-9_-]{5,}|sb_secret_|eyJhbGciOi|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}' {} 2>/dev/null
```

This should return nothing. Matches on the literal word `service_role` are
fine — that is a Postgres role name, not a secret.

> **If you ever do commit a secret:** rotate it in the Supabase/Google/provider
> dashboard. Deleting the commit is not enough — GitHub retains unreferenced
> objects, and push mirrors and forks may already have it.

---

## 2. Environment variables in Vercel

Set these in **Project → Settings → Environment Variables**. Nothing in this
list belongs in the repository.

### Required for a real deployment

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Safe to expose; it is in the browser bundle by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Safe to expose — RLS is what protects the data, not this key |

### Required for user-supplied AI keys

| Variable | Notes |
|---|---|
| `FLOWCARE_KEY_ENCRYPTION_SECRET` | 64 hex chars. **Without it, FlowCare refuses to store user keys** rather than encrypting under a weak secret |

Generate it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Rotating this value makes every stored user key permanently
> undecryptable.** Users must re-enter their keys. There is no recovery path,
> deliberately — a recoverable master key is a master key someone can recover.

### Optional

| Variable | Effect if unset |
|---|---|
| `GOOGLE_MAPS_API_KEY` | No Places search, details or photos |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Built-in schematic map instead of Google tiles |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / … | Server-funded AI off; users can still bring their own key |
| `GOOGLE_ROUTES_ENABLED` | Straight-line distance only, never an invented journey time |
| `FLOWCARE_DEMO_MODE` | Leave **unset** in production. Setting it to `true` forces synthetic data |

**Never** create a `NEXT_PUBLIC_` variable for a server secret. The only
intentionally-public key is the Maps browser key, and it must be
HTTP-referrer restricted to your Vercel domain and limited to the Maps
JavaScript API alone.

`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` and friends are used only by
`scripts/db/*` from your own machine. **Do not put them in Vercel** — the
deployed app never connects to Postgres directly.

---

## 3. Supabase configuration

1. **Auth → URL Configuration**
   - Site URL: `https://<your-app>.vercel.app`
   - Redirect URLs: add the same origin, plus `http://localhost:3000` for local work.
   Without this, confirmation links point at the wrong host.

2. **Auth → Providers → Email** — decide whether to require email
   confirmation. `private.actor()` rejects users without `email_confirmed_at`,
   so with confirmation on, a brand-new user can sign in but cannot write
   until they confirm. That is intended.

3. **Migrations** — run from your machine, not from Vercel:

   ```bash
   npm run db:status
   npm run db:backup
   npm run db:migrate:dry
   npm run db:migrate
   ```

---

## 4. Deploy

```bash
# first push
git init && git add -A && git commit -m "FlowCare"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then import the repository on Vercel. It will detect Next.js automatically;
the build command is the default `next build`.

> `npm run build:ci` exists for local use only — it writes to `.next-build`
> so a production build never stomps a running `next dev`. Vercel should use
> the plain default.

---

## 5. Things that behave differently once hosted

These are real, and worth knowing before you rely on them.

### 5.1 Rate limiting weakens on serverless

`src/lib/ratelimit.ts` is an in-memory fixed-window limiter. On Vercel each
serverless instance has its own memory, so limits are enforced **per warm
instance**, not globally. Under concurrency the effective limit is higher than
the configured number.

What this does and does not affect:

- **Not a data-security problem.** Every authorisation decision is made by
  Postgres RLS, which is unaffected.
- **It is a cost problem** for endpoints that call a paid API. `/api/assistant`
  and `/api/assistant/agent` both require a signed-in user and, when the user
  has brought their own key, spend *their* quota rather than yours.
- **Fix before real traffic:** move the limiter to a shared store (Upstash
  Redis, or a Postgres table with a fixed window). This is listed as
  outstanding, not done.

### 5.2 Middleware runs on every matched request

`src/middleware.ts` refreshes the Supabase session cookie. The matcher already
excludes static assets. It deliberately does **not** gate routes — adding
route gating there would create a second, weaker authorisation source
alongside RLS.

### 5.3 The app currently runs on demo data

`supabaseRepo.ts` is not yet ported to the real schema, so hospital discovery
still reads synthetic records. Auth, API keys and the agentic booking flow in
this deployment talk to the **real** database; discovery does not. The demo
banner says so on every page.

### 5.4 Google Maps key restrictions

The server key (`GOOGLE_MAPS_API_KEY`) should be restricted by API, and — if
you can obtain Vercel's egress ranges — by IP. The browser key must be
restricted by HTTP referrer to your deployed domain. An unrestricted browser
key is a billable resource anyone can lift from your page source.

---

## 6. Post-deploy checklist

```
[ ] .env.local is NOT in the repository
[ ] backups/ is NOT in the repository
[ ] Supabase Site URL matches the deployed origin
[ ] FLOWCARE_KEY_ENCRYPTION_SECRET set (or accept that key saving is off)
[ ] FLOWCARE_DEMO_MODE is unset
[ ] Sign-up → confirm email → sign-in works on the deployed origin
[ ] /settings saves a key and "Test key" reports a real result
[ ] Maps browser key referrer-restricted (if used)
[ ] Rate limiter replaced with a shared store before real traffic
```

---

## 7. What hosting does not make true

Deploying does not make FlowCare production-ready, and the README's status
section still applies. In particular: no load test has been run, no
accessibility audit has been done, the repository port is outstanding, and the
rate limiter is not multi-instance safe. A working URL is not evidence of any
of those.
