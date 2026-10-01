# Deploying without connecting GitHub

The Git integration is the default path, not the only one. Everything below
produces the same running app; they differ only in what you have to hand over.

A ready-made payload is built for you at `FlowCare-deploy.zip` (584 KB). It is
this repository minus `node_modules`, `.git`, `deck/`, `docs/`, `tests/`,
`scripts/`, `backups/`, `.data/` and **`.env.local`** — verified by a secret
scan before packing. `.env.example` is included; no real key is.

---

## Option 1 — Vercel CLI from your own machine (recommended)

No repository connection, no token leaves your laptop.

```bash
unzip FlowCare-deploy.zip -d flowcare && cd flowcare
npx vercel login          # opens a browser, one time
npx vercel                # preview deployment
npx vercel --prod         # promote to production
```

The CLI uploads the directory directly. The first run asks a few questions;
accept the detected **Next.js** framework and the defaults — `vercel.json`
already pins the region to `bom1` and sets the security headers.

Then add the environment variables, either in the dashboard under
**Project → Settings → Environment Variables** or from the terminal:

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel --prod         # redeploy so they take effect
```

Only those two are needed to boot. See `.env.example` for the rest.

---

## Option 2 — Build locally, upload only the output

Useful on a slow connection, or to keep the source off the host entirely.

```bash
npx vercel build          # builds into .vercel/output
npx vercel deploy --prebuilt --prod
```

---

## Option 3 — Somewhere other than Vercel

FlowCare is a standard Next.js App Router app with server routes, so it needs
a Node runtime. It **cannot** be exported as a static site: `next export`
would drop every `/api/*` route, which is the whole backend.

| Host | How | Notes |
|---|---|---|
| **Netlify** | `npx netlify deploy --prod` | Needs `@netlify/plugin-nextjs`. Same read-only filesystem caveat as Vercel |
| **Cloudflare Pages** | `npx wrangler pages deploy` | Workers runtime, not Node — `@supabase/supabase-js` touches `process.version`, so expect work |
| **Render / Railway** | Connect or push a Docker image | **Real disk and a long-lived process**, so the filesystem writes below keep working |
| **Any VPS** | `npm ci && npm run build && npm start` behind nginx | Most control, most upkeep |

---

## Before any of this goes public

### The filesystem writes will break on serverless

Three modules persist state to disk:

```
src/lib/data/demoRepo.ts:67         fs.writeFileSync(STATE_FILE, …)
src/lib/data/liveRepo.ts:259        fs.writeFileSync(REQ_FILE, …)
src/lib/staff/accessRequests.ts:37  fs.writeFile(FILE, …)
```

On Vercel, Netlify and Cloudflare the filesystem is read-only apart from
`/tmp`, which is per-instance and discarded between invocations. Hosted on any
of them, **booking an appointment and submitting or approving a staff access
request will fail or silently vanish on the next cold start.**

Two ways out:

1. Move those three stores into Supabase tables — migration `0009`. The
   durable fix, and it is on the plan already.
2. Host somewhere with a real disk (Render, Railway, a VPS), where the
   current code works unchanged.

### What a visitor would actually get today

- `SUPABASE_SERVICE_ROLE_KEY` is unset, so no staff role can ever be granted.
  Every real account is a patient; the staff screens are reachable only
  through the demo accounts.
- The live project has no `sessions` table, so only the two `[TEST]` hospitals
  out of 62 are bookable.
- Leave the data-source notice switched on. It is the thing telling visitors
  which records are synthetic, and removing it while the data still is would
  misrepresent the app.

### Rate limiting

`src/lib/ratelimit.ts` counts in process memory. Each serverless instance has
its own, so the effective limit is per warm instance rather than global. Fine
for a demo; needs a shared store before it protects anything real.
