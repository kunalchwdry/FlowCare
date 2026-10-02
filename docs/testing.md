# Testing

## Running

```bash
npm run typecheck     # tsc --noEmit
npm run build         # ALWAYS run before calling a milestone done (see below)
npm test              # vitest run --no-file-parallelism
```

Two of the eight suites (`api.security`, `api.journey` — 70 tests) make real
HTTP requests and need a server on `http://127.0.0.1:3000`. **Start it before
`npm test`.** If nothing is listening they skip loudly rather than passing
silently; a green run full of skips is not a pass.

```bash
npm run build && npm start     # recommended target for the HTTP suites
npm test                       # in another shell
```

### Use `npm start`, not `npm run dev`, for the HTTP suites

Measured in this sandbox (~2 GB RAM): under the HTTP suites the **dev** server
grows past 1.2 GB RSS, at which point Next prints
`⚠ Server is approaching the used memory threshold, restarting...` and cycles.
Requests in flight fail with `ECONNREFUSED`, which looks exactly like an
application bug and is not. On a smaller box the kernel OOM-killer gets there
first — and because `npm` masks the child's `SIGKILL`, the process reports a
clean **exit code 0**, which is thoroughly misleading.

The production server carries no webpack instance and no on-demand
compilation. It sat at a flat ~1.1 MB reported RSS across five consecutive
full runs with zero flakes.

`npm run dev` now also caps the heap (`--max-old-space-size=768`) so the dev
server degrades gracefully instead of being killed outright.

## Current status — honestly reported

**273 passed, 0 failed, 0 skipped** for the offline command, measured
2026-09-28 against `npx next start` on `:3000`.

| Suite | Tests | Needs a server |
|---|---:|---|
| `tests/rating.test.ts` | 12 | no |
| `tests/search.test.ts` | 23 | no |
| `tests/ai.test.ts` | 22 | no |
| `tests/reviews.test.ts` | 21 | no |
| `tests/places.test.ts` | 15 | no |
| `tests/journey.test.ts` | 59 | no |
| `tests/keyvault.test.ts` | 15 | no |
| `tests/agent.test.ts` | 28 | no |
| `tests/api.security.test.ts` | 34 | **yes** |
| `tests/api.journey.test.ts` | 37 | **yes** |
| `tests/api.booking.test.ts` | 7 | **yes** |

`api.booking` covers the slot-request endpoint added on 2026-09-28: 401 when
signed out, 404 for an unknown session, 400 for a payload carrying extra
fields (a client trying to set its own `status` or `hospitalId`), status
`requested` with `confirmed: false` on success, no double-booking of one
session by one patient, a seat actually consumed from capacity, and a
cross-patient read of the receipt returning 404.

## Live-read mode and the HTTP suites

`FLOWCARE_LIVE_READS=true` points the facility record at the real Supabase
project. **The HTTP suites do not pass in that mode, and that is not a
regression**: they assert against demo fixtures (the `baner-ridge-...` slug,
seeded reviews, seeded queue snapshots) which do not exist in the live
project, where `hospital_reviews` is empty and there is no sessions table.

Measured 2026-09-28, same build:

| Server mode | Result |
|---|---|
| `FLOWCARE_LIVE_READS=false` (demo fixtures) | **273 passed, 0 failed, 0 skipped** |
| `FLOWCARE_LIVE_READS=true` (live facility record) | 254 passed, **19 failed** - all fixture lookups |

So the automated protocol is: **run `npm test` against a demo-mode server.**
Live-read mode is verified separately by the browser walkthrough (12 checks:
banner wording, live hospital names, filters, map, saved, compare, assistant,
booking, receipt, visits), which passed 12/12 on the same build.

`tests/api.booking.test.ts` resolves a bookable hospital from the API at
collection time instead of hardcoding a slug, so it exercises whichever
dataset is actually being served rather than quietly returning early.

## What these tests do NOT cover

Stated plainly, because "223 passing" invites the wrong conclusion.

- **No live Supabase.** `supabaseRepo.ts` and all three migrations are written
  against the schema but have **never been executed against a real Postgres**.
  No PostgreSQL binary and no root access were available here; the migrations
  are only *syntax-checked* with `pglast` (0001: 43 statements, 0002: 45,
  0003: 83 — all parse, zero `DROP`s). **RLS policies are unexecuted.** The
  cross-patient isolation tests prove the *application* layer isolates
  correctly; they say nothing about whether the RLS policies work, because in
  demo mode there is no database.
- **No live Google.** Places, Photos and the Routes API have never been called
  with a real key. Every Google path is exercised only in its
  "not configured" degradation.
- **No live LLM.** All AI tests use stubbed providers.
- **F16 is untested in its enabled state**, by design — it ships dark pending
  a legal read.
- **No browser test.** Page assertions are server-rendered HTML checks
  (asserting real app content and the *absence* of Next's error markers —
  the dev error page is valid HTML served with a 200, so `/<html/` alone is
  worthless). No click-through, no JS execution, no accessibility audit.
- **No load or performance measurement.**

## Hazards worth knowing before you edit

- **A Next.js route file may only export HTTP verb handlers** (plus framework
  config). A shared constant declared there breaks `next build` while
  `tsc --noEmit` stays happy — which is why `npm run typecheck` alone is never
  sufficient. Shared constants live in `src/lib/**`
  (e.g. `lib/journey/limits.ts`).
- **Never run `next build` against `.next` while `next dev` is serving it.**
  The dev server dies with `MODULE_NOT_FOUND` and then serves Next's error
  page with **HTTP 200**. Use `npm run build:ci` (`NEXT_DIST_DIR=.next-build`).
- **Rate limits are counted before validation**, deliberately — a flood of
  malformed requests is still a flood. The consequence for tests is that a
  file exercising rejection paths burns the same budget as one exercising
  success paths. Both HTTP suites therefore call `POST /api/demo-reset` in a
  file-level `beforeAll`, which clears demo state *and* rate-limit buckets.
  That endpoint 404s outside demo mode and requires an admin session.
- **`testTimeout` is 20s, not the 5s default.** The HTTP helpers back off and
  retry on 429, and that budget can reach ~6s. With the default timeout the
  failure surfaces as "Test timed out" instead of the assertion the test was
  actually making — which sent this work chasing a phantom bug once already.
- **`it.runIf(cond)` evaluates `cond` at collection time**, so a `beforeAll`
  server probe always yields "skipped". Both HTTP files probe at module load
  with a top-level `await`.
- `import 'server-only'` throws under Vitest; aliased to
  `tests/stubs/server-only.ts`.
- The demo repo persists to `.data/demo-state.json`, which survives restarts.
  Delete it after changing the seed.

---

## Totals (2026-09-28, measured)

```
npm test  (server running on :3000)   273 passed | 0 failed | 0 skipped  11 files
npm run test:live                      75 passed | 0 failed | 0 skipped   4 files
                                      ---------------------------------
                                      348 passed | 0 failed | 0 skipped
npx tsc --noEmit                       clean
npm run build:ci                       succeeds
```

The live figure (75) was measured on 2026-09-27 against the real Supabase
project and has not been re-run since; the offline figure is from today.
**Run the offline suite with a server up** — `FLOWCARE_TEST_BASE_URL=http://127.0.0.1:3000 npm test` — or the
two HTTP suites report 71 skips and prove nothing.


## Running the HTTP tests

The HTTP suites talk to a server you start yourself. It must be started with
demo accounts explicitly enabled:

```bash
FLOWCARE_DEMO_MODE=true \
FLOWCARE_ALLOW_DEMO_AUTH=true \
FLOWCARE_LIVE_READS=false \
FLOWCARE_DEMO_HOSPITAL_ID= \
  npx next start -p 3000
```

`FLOWCARE_ALLOW_DEMO_AUTH=true` is not optional and not a workaround.
`next start` is a production build, and on a production build with a real
Supabase project configured FlowCare refuses the demo cookie outright — a
cookie that names an administrator must not be a credential on a public
origin. The test harness is a deliberate demo, so it opts in deliberately.

Omitting it looks like a code regression: every authenticated request comes
back 401 and roughly 25 tests fail on status codes.

Run against that server with:

```bash
FLOWCARE_LIVE_READS=false FLOWCARE_DEMO_HOSPITAL_ID= npx vitest run
```
