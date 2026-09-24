# FlowCare — Implementation Mode
## Part 4 · Codebase inspection

**Date of inspection:** 27 September 2026
**Mode:** Inspection only. **No source file was modified, added, or deleted during this inspection.** The only files written in this session are the four research documents under `docs/research/`.

---

## 1. What I actually inspected

Working tree: `/home/user/flowcare`. Full inventory as found:

```
9  page routes        (src/app/**/page.tsx)
17 API route files    (src/app/api/**/route.ts)
31 library modules    (src/lib/**/*.ts)      ~3,900 LOC
12 React components   (src/components/*.tsx) ~2,450 LOC
6  test files         (tests/*.test.ts)      127 tests
2  SQL migrations     (supabase/migrations/)
```

**Verification commands run (read-only):**

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx vitest run` | ✅ **127 passed / 0 failed / 0 skipped**, 6 files, 18.0 s |
| `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/hospitals` | ✅ `200` |

> **Transient finding worth recording.** My first `vitest run` this session reported **11 failures, all `ECONNREFUSED 127.0.0.1:3000`** in `tests/api.security.test.ts`. The dev server was mid-restart. After confirming the server responded with `200`, the identical command returned 127/127.
> The tests are correct; the **harness is fragile**. `tests/api.security.test.ts` depends on an externally-managed server and its module-load probe does not distinguish "server absent" (skip, warn loudly) from "server briefly unreachable" (fail). A future contributor seeing 11 red tests will reasonably conclude the code is broken. Recommend a bounded retry in the probe, or a `globalSetup` that starts and owns the server. **I have not made this change** — it is a recommendation, not an edit.

---

## 2. Stack divergence — the finding that must be resolved first

The brief describes a system this workspace does not contain.

| | Brief describes | This workspace contains |
|---|---|---|
| Frontend | React + Vite + React Router | **Next.js 15.5.26 App Router** + React 19 |
| Backend | Express / Node | **Next.js route handlers** (`runtime = 'nodejs'`) |
| Database | MongoDB + Mongoose | **Supabase / PostgreSQL** (`@supabase/ssr`, `@supabase/supabase-js`) |
| Data fallback | "fixture fallback when MongoDB unavailable" | `getRepo()` → `demoRepo` (file-backed JSON) or `supabaseRepo` |
| Tests | 13 passing | **127 passing** |
| Cost transparency | listed as **implemented** | **absent — see §2.1** |

The *architectural intent* matches closely — a repository abstraction with a fixture fallback, strict source labelling, an availability freshness contract, separated rating systems, a bounded AI layer. The *implementation* does not. I have not attempted to reconcile these, and nothing in the research documents assumes one over the other.

**Please confirm which repository is authoritative before any feature work begins.** If there is a second FlowCare repo, `01-research-and-problems.md` §2 and the matrices in Parts 2–3 should be re-checked against it; the research findings themselves are product-level and remain valid either way.

### 2.1 Cost transparency is specified but not implemented here

Search across the domain model:

```
grep -rin "cost|price|fee|consultation_fee"  src/lib/types.ts  src/lib/discovery/filters.ts
→ 0 matches
```

`src/lib/types.ts` declares 22 interfaces/types (`Hospital`, `HospitalDepartment`, `HospitalService`, `HospitalAvailability`, `FlowCareRatingSummary`, `ExternalPlaceData`, `DiscoveryResult`, `MatchExplanation`, `Appointment`, `ClinicSession`, …). **None carries a monetary field.** `src/lib/discovery/filters.ts` exposes 24 filter keys — none is cost-related. There is no cost column in either migration.

Conclusion: in *this* codebase, cost transparency is **designed but not built**. Feature **F5** in `02-feature-opportunities.md` is written accordingly, as a completion rather than an invention.

---

## 3. Extension-point assessment

Rated for how well each existing asset supports the proposed features. Read-only assessment; no changes made.

### 3.1 Strong extension points

**`Repo` interface — `src/lib/data/repo.ts` (59 LOC)**
A clean 18-method interface implemented twice (`demoRepo` 192 LOC file-backed, `supabaseRepo` 268 LOC) and selected by `getRepo()`. This is the single most valuable structural property in the codebase: every proposed feature can be developed and fully tested without a live Supabase project. `AuditEvent.metadata` already carries the inline contract *"Must contain no free-text patient content and no precise location"* — exactly the guard F3 (care-context labels) and F19 (visit records) need. **Extends cleanly.**

**`src/lib/discovery/availability.ts` (68 LOC)**
The freshness model F18 should generalise: explicit `unknown` state, computed from observed sessions only, never inferred from opening hours, with `AVAILABILITY_WINDOW_DAYS` and `AVAILABLE_THRESHOLD` as named constants. F18 is this pattern applied to every other fact. **Lift, do not reinvent.**

**`src/lib/places/policy.ts` (64 LOC)**
`PLACES_POLICY` plus `coordCacheExpired()`, `placeIdNeedsRefresh()` and `assertPersistable()`. `assertPersistable()` already throws for `displayName`, address, rating, reviews, photos, hours, phone and website — i.e. for every field F16 must not store. The correct move for F16 is an `assertHashable()` sibling, **not** a relaxation of the existing guard. **Extends cleanly, with one caveat (§4.2).**

**Moderation stack — `src/lib/reviews/moderation.ts` (125 LOC) + `review_reports` + `review_moderation_events` + admin-gated routes**
`moderateSubmission(comment, context)` already implements URL/phone/email detection, abuse flags, repeated-character and all-caps heuristics, and Jaccard ≥0.85 duplicate detection, and crucially only ever suggests `'published' | 'pending'` — never auto-rejects. F17 (facility corrections) is a near-direct reuse: same queue shape, same audit discipline, same admin authorisation. **This is why F17 is the cheapest high-value item in the plan.**

**`src/lib/analytics.ts` (122 LOC)**
Inline comment: *"Only these keys are ever recorded, and only as booleans/counts."* `filterFingerprint` records query **length** only; `locationBucket` coarsens to ~11 km. This is the right architecture. The work for F3/F19/F20 is to add **rejections** to the allowlist, never permissions.

**`src/lib/discovery/filters.ts` (240 LOC)**
Closed vocabularies as `as const` tuples — `SPECIALTIES`, `SERVICES`, `HOSPITAL_TYPES`, `ACCESSIBILITY_FEATURES` (7 values), `LANGUAGES` (9 values) — each wrapped in `z.enum()` with array caps. F7 (accessibility components) and F8 (per-stage languages) extend these vocabularies rather than replacing the mechanism.

**`src/lib/places/client.ts` (240 LOC)** — `PlacesOutcome<T>` with `status: 'ok' | 'not_configured' | 'error'` is exactly the right envelope for F6's travel-time calls and F16's comparison calls. **Reuse verbatim.**

**`src/lib/http.ts` (45 LOC)** and **`src/lib/ratelimit.ts` (31 LOC)** — `handleError`, `readJson(maxBytes)`, `tooMany()` with `Retry-After`, `clientKey()`. No changes needed.

### 3.2 Points of friction

| # | Friction | Impact | Suggested resolution *(not applied)* |
|---|---|---|---|
| 1 | **Route handlers cannot export arbitrary constants.** `tsc --noEmit` passes; only `next build` catches it. This codebase has hit it three times. | F1's dictionary, F18's TTL policy, F7's component vocabulary and F20's task enum are all shared constants at risk. | Every new constant lives in `src/lib/**`. Add an ESLint rule restricting non-HTTP-verb exports in `src/app/api/**/route.ts`. |
| 2 | **`recently viewed` (browser-local, 8 items, clearable) vs `visit_record` (F19: server-side, RLS-isolated, opt-in, 24-month retention)** will look identical to users but have opposite privacy postures. | User confusion about what FlowCare stores — directly undermines the F19 opt-in. | Keep them visually distinct, or merge under one explicitly-labelled surface. Decide before building F19. |
| 3 | **`supabaseRepo.ts` has never run against a live Supabase project.** | Every new table inherits this gap. | Nothing built on it may be called production-ready until the migrations actually execute. |
| 4 | **Migrations are `pglast`-syntax-checked only** — no PostgreSQL and no root in this environment (`apt-get install postgresql` fails on dpkg permissions; do not retry). | RLS policies, constraints and the `fc_expire_cached_place_coords()` helper are unexercised. | Run against a real Supabase project before trusting any RLS claim. |
| 5 | **`DiscoveryExplorer.tsx` is 456 LOC and owns query, filters, view mode, compare basket, favourites and URL sync.** `HospitalProfile.tsx` is 479 LOC. | F3 (care contexts) touches both; F6 (mode selector) and F16 (discrepancy markers) touch both. Merge-conflict and regression risk. | Extract the filter/URL-sync state into a hook before adding a care-context dimension. |
| 6 | **`ratelimit.ts` is single-process in-memory.** | F17's abuse controls (R6) are the first feature where this actually matters — a correction channel behind a per-instance limiter is trivially bypassed at scale. | Move to a shared store before F17 launches publicly. Documented limitation today; a real gap for F17. |
| 7 | **`tests/api.security.test.ts` fails hard on a transient server outage** (see §1). | False red builds. | Bounded retry in the module-load probe, or a `globalSetup` owning the server. |

---

## 4. Specific constraints the code imposes on the proposed features

### 4.1 The Places policy constrains F6, F10, F11 and F16 more tightly than the features assume

`PLACES_POLICY` permits persisting only `placeId` and cached coordinates (≤30 days), with `PLACE_ID_REFRESH_DAYS = 365` and `DISPLAY_CACHE_TTL_MS = 300000`. Concretely:

- **F6 (travel time):** results are Google content → **not persistable at all**. Recompute per view within the 5-minute display cache. The spec already says this; the code will enforce it via `assertPersistable()`.
- **F11 (offline card):** must contain **zero** Google-sourced fields. No rating, no photo, no opening hours, no Google-supplied phone. Only FlowCare's own facility record. The spec says this; it needs a test.
- **F10 (arrival photos):** no Places photo may be re-hosted. FlowCare-captured or hospital-supplied only.

### 4.2 F16 needs a decision the code cannot make

F16 proposes storing a **salted hash** of a Google field value so a discrepancy is durable while the content is not. `assertPersistable()` operates on *field names*, so it would reject `formattedAddress` outright — the feature needs a deliberate, reviewed exception (`assertHashable()`), not a quiet bypass.

My reading is that a non-reversible salted hash is not "caching content" under Maps Service Terms §14, because nothing displayable can be recovered from it. **I am not the right person to make that call.** Flagged in `03-review-and-plan.md` §10.3 as requiring a written legal read before F16 is built.

### 4.3 Seed data will need extending for every new fact type

`src/lib/data/seed.ts` (354 LOC) generates 15 fictional hospitals via `mulberry32` keyed on a slug hash, with deliberate edge cases (a hospital with no sessions, one with all sessions full, three straddling the 5-review threshold, three unlinked from Google). This edge-case discipline is good and should be preserved: every new fact type needs a `verified`, an `ageing`, a `stale` and a `never-verified` fixture, or F18's three-state rendering will not be genuinely tested.

**Operational note:** `demoRepo` is file-backed at `.data/demo-state.json`. **Delete `.data/` after any seed change** or stale state persists.

### 4.4 The clinical-boundary guards already exist and should be extended, not duplicated

`src/lib/ai/intent.ts` (167 LOC) already implements emergency-signal detection, `withDeadline()`, strict `AiFilterSchema.safeParse` with `mergeFilters`, and a source tag of `'llm' | 'deterministic' | 'llm_rejected_fallback'`. `src/lib/ai/fallback.ts` (230 LOC) contains the ~18-term lay-synonym map that **F1 should absorb and formalise** — F1 is not a new subsystem, it is `fallback.ts`'s dictionary promoted to a first-class, versioned, clinically-reviewed, UI-visible asset.

F9's clinical-text blocklist is a new guard with no existing analogue and will need to be written from scratch.

---

## 5. Honest status ledger

Using the four-level distinction the project requires.

| Capability | Implemented locally | Tested locally | Externally configured | Externally verified | Production-ready |
|---|:--:|:--:|:--:|:--:|:--:|
| Discovery search, filters, pagination | ✅ | ✅ 23 tests | n/a | n/a | ❌ |
| FlowCare rating `fc-rating-v1` | ✅ | ✅ 12 tests | n/a | n/a | ❌ |
| Review eligibility + moderation | ✅ | ✅ 21 tests | n/a | n/a | ❌ |
| Availability engine + freshness | ✅ | ✅ (in search suite) | n/a | n/a | ❌ |
| AI assistant (intent, fallback, evidence) | ✅ | ✅ 22 tests | ❌ no provider keys | ❌ **never called with a real key** | ❌ |
| Google Places layer + policy | ✅ | ✅ 15 tests (mocked) | ❌ no API key | ❌ **never called against the live API** | ❌ |
| API security (authz, RLS, rate limits, redaction) | ✅ | ✅ 34 tests vs a live dev server | n/a | ❌ | ❌ |
| Supabase repository | ✅ | ❌ **never executed** | ❌ | ❌ | ❌ |
| SQL migrations (2 files, 0 DROPs) | ✅ | ⚠️ **`pglast` syntax check only** | ❌ | ❌ | ❌ |
| RLS policies | ✅ written | ❌ **never enforced by a real Postgres** | ❌ | ❌ | ❌ |
| Cost transparency | ❌ **absent** | ❌ | ❌ | ❌ | ❌ |
| All 20 proposed features (F1–F20) | ❌ | ❌ | ❌ | ❌ | ❌ |

**Nothing in this codebase is production-ready.** The UI renders and 127 tests pass, which demonstrates that the logic is internally consistent — not that it works against real infrastructure. Three whole categories (Supabase, Google Places, every AI provider) have never been exercised with real credentials.

---

## 6. Changes I did not make

Recorded because the brief requires no silent modification. Each of these is a recommendation I deliberately left unapplied:

1. Bounded retry in the `tests/api.security.test.ts` server probe (§1).
2. ESLint rule against non-verb exports in `src/app/api/**/route.ts` (§3.2 #1).
3. Extracting filter/URL-sync state out of `DiscoveryExplorer.tsx` (§3.2 #5).
4. Any cost field, anywhere (§2.1) — pending the repository-authority question.
5. Any `assertHashable()` relaxation of the Places policy (§4.2) — pending legal review.
6. Moving `ratelimit.ts` to a shared store (§3.2 #6).

---

## 7. Recommended next actions

**Blocking, before any feature work:**
1. Resolve the repository-authority question (§2). Everything downstream depends on it.
2. Run the two migrations against a real Supabase project and execute `supabaseRepo` against it. Until then no RLS or persistence claim is defensible.

**Cheap and high-value, independent of the above:**
3. Run **E1** (100-facility secret-shopper directory audit, `03-review-and-plan.md` §13). It is ~40 hours and it determines whether F17/F18 are Band 1 or Band 2.
4. Run **E4** (offline Care Need Translator recall test). No users, no ethics approval, gates F1.
5. Fix the test-harness fragility in §1 so future red builds mean something.

**Long lead time — start the paperwork now:**
6. Ethics approvals for **E2** (wayfinding field trial) and **E6** (participatory accessibility audit).
7. Legal read on the F16 hashing question (§4.2).
