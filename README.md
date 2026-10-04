# FlowCare

**A hospital discovery and outpatient appointment platform for Indian cities, built so that a patient can tell the difference between a fact and a guess.**

FlowCare started as an outpatient appointment app. It is now an end-to-end
journey: **Discover → Search → Filter → Compare → Understand → Choose → Book →
Prepare → Travel → Arrive → Track → Follow up.**

Its distinguishing property is not the feature list. It is that **every claim
on the screen can be traced to a source, a date and a verifier** — and where
that chain is missing, FlowCare says so instead of filling the gap with a
plausible default.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [What FlowCare does](#2-what-flowcare-does)
3. [The rules the product is built around](#3-the-rules-the-product-is-built-around)
4. [Quick start](#4-quick-start)
5. [How it works](#5-how-it-works)
6. [Feature catalogue](#6-feature-catalogue)
7. [Data model](#7-data-model)
8. [Security model](#8-security-model)
9. [The AI assistant](#9-the-ai-assistant)
10. [External data and policy compliance](#10-external-data-and-policy-compliance)
11. [Testing](#11-testing)
12. [Project layout](#12-project-layout)
13. [Current status — what is actually true](#13-current-status--what-is-actually-true)
14. [Known limitations](#14-known-limitations)
15. [Attribution and licensing](#15-attribution-and-licensing)

---

## 1. The problem

Finding the right hospital in an Indian city is not a search problem. It is a
**trust problem**. The research behind this project (37 graded sources in
`docs/research/sources.md`, plus a second and third review pass) found the same
failure repeating at every step:

| Stage | What actually goes wrong | Evidence |
|---|---|---|
| Finding | Provider directories are wrong about half the time | CMS Round 3: **48.7%** of 10,504 locations had ≥1 inaccuracy; 41% of deficiencies were "should not be listed at this location" (S01) |
| Booking | A listing being present does not mean you can get an appointment | Senate secret-shopper study: bookable only **18%** of the time (S03) |
| Judging | Star ratings do not measure clinical quality and barely discriminate | Ratings cluster narrowly and correlate poorly below **~15 reviews**; ~34% of providers are unreviewed (S62–S64) |
| Paying | People know the scheme exists but not where it is accepted | Meerut: **96.6%** aware of PM-JAY, **30.3%** aware of empanelled hospitals (S49); 74% of 1.1 lakh grievances were "hospital demanding money" (S52) |
| Arriving | Signage does not work | Odisha (n=45): **91%** could not reach their destination by signage alone (S19); Bhopal (n=336): **69.6%** needed human help (S20) |
| Access | Physical accessibility is far worse than reported | PwD-led audit of 35 government hospitals: overall **32.6%**, accessible toilets **4.0%** (S25) |
| Remembering | Most of what you are told is gone by the time you leave | **40–80%** of medical information is forgotten immediately, and about half of what is retained is wrong (S35) |

Every one of those is a problem of **information that is absent, stale or
unverifiable** — not a problem of insufficient listings. So FlowCare is built
around provenance rather than around volume.

---

## 2. What FlowCare does

**For patients**

- Search hospitals by name, locality, specialty, service or plain language
  ("dialysis near Kothrud that takes Ayushman Bharat").
- Browse nearby on a map or a list; compare up to four side by side.
- See, per fact, **where it came from and when it was last checked**.
- Book into departments that are genuinely integrated, and see clearly when a
  hospital is listed for discovery only.
- Prepare for the visit: what to bring, what it may cost, how to get there,
  where the entrance is.
- Track what happens after: follow-ups, referrals, results, and changes to the
  appointment.
- Invite a family member to help — with **scoped, expiring, revocable,
  read-only** access rather than by sharing a password.

**For hospital staff**

- Per-hospital membership with explicit permissions (no global admin role).
- Queue and appointment management through an auditable state machine.
- Review moderation and patient-submitted fact corrections, both of which
  require a human decision and are recorded.

**For the operator**

- A fact-freshness view across every published claim, so decay is visible.
- Append-only audit trails on memberships, appointments, moderation,
  corrections and care delegations.

---

## 3. The rules the product is built around

These are enforced in code and in database constraints, not in a style guide.
Most have a test named after them.

| Rule | Where it is enforced |
|---|---|
| An unverified fact can never display as fresh | `freshnessOf()` in `src/lib/provenance.ts` |
| Availability is never inferred from opening hours | No sessions ⇒ `unknown`, always |
| A filter that cannot be enforced is never offered | `isFilterableVerification()` |
| The Google rating and the FlowCare rating are never mixed | Separate fields, separate components, separate aggregation |
| A FlowCare review requires a completed, verified visit | `visits.state='completed'` joined via `visits.appointment_id` |
| Below 5 counted reviews, no score is shown | `MIN_PUBLISH_COUNT = 5` → "Not enough FlowCare reviews yet" |
| AI may flag, never decide | `moderation_ai_cannot_finalise` CHECK constraint |
| An LLM never writes a database query | Intent → Zod-validated allowlist → parameterised search |
| No clinical data ever reaches a model | `CLINICAL_BLOCKLIST` on both write paths |
| Legal guardianship is never inferred | `dependent_profiles.relationship_basis` has exactly one legal value |
| A patient-reported referral can never look hospital-issued | `source = 'patient_reported'` pinned by CHECK |
| Unauthorised reads return `NOT_FOUND`, never "forbidden" | Existence is never leaked |
| There is no aggregate "trust score" | Deliberately absent; freshness is shown per fact |
| There is no "best hospital" ranking | Comparison is a table, not a leaderboard |
| A slot request is never presented as a confirmed booking | `status = 'requested'`, `confirmed: false`, amber "waiting for the hospital to confirm" |
| A booking payload cannot choose its own hospital, department or time | Only `sessionId` is accepted; everything else is read from the session server-side |

---

## 4. Quick start

**Requirements:** Node 20+. No database needed to run the app.

```bash
git clone <repo> && cd flowcare
npm install
cp .env.example .env.local     # every value is optional
npm run dev                    # http://localhost:3000
```

With **no configuration at all**, FlowCare boots in demo mode: local synthetic
data that is labelled as synthetic everywhere it appears, a deterministic
(non-LLM) assistant, and a built-in schematic map instead of Google tiles. It
is fully usable in this state, which is intentional — nothing in the core
journey is gated behind a paid API key.

**Optional capabilities**, each independently enabled:

| Set this | To get |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Real accounts, RLS, persistence |
| `GOOGLE_MAPS_API_KEY` | Places search, details, photos, autocomplete |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Google map tiles (otherwise a schematic map) |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / … | LLM intent extraction, funded by the operator |
| `FLOWCARE_KEY_ENCRYPTION_SECRET` | Lets users store **their own** provider keys (`/settings`) |
| `GOOGLE_ROUTES_ENABLED=true` | Mode-aware travel times (otherwise straight-line distance only) |

Never prefix a server secret with `NEXT_PUBLIC_`. See `.env.example`, which
contains placeholders only.

**Database scripts** (only if you have a Supabase project):

```bash
npm run db:status        # applied vs pending migrations
npm run db:migrate:dry   # verify inside a rolled-back transaction
npm run db:backup        # snapshot every row + DDL before changing anything
npm run db:migrate       # apply
npm run db:seed          # load 60 real Pune hospitals from OpenStreetMap
```

**Tests:**

```bash
npm run typecheck
npm test                                                  # 388 with a server up
FLOWCARE_TEST_BASE_URL=http://127.0.0.1:3000 npm test     # explicit HTTP target
npm run test:live                                         # requires live-db credentials and test users
```

> Run the offline suite **with a server running**, or the two HTTP suites skip
> 71 tests and a green run proves nothing.

---

## 5. How it works

### Stack

Next.js 15 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth +
RLS) · Zod · Vitest.

### Request flow

```
Browser
  │  never holds an API key, never calls Google or an LLM directly
  ▼
Next.js route handler  (src/app/api/**)
  │  Zod validation → rate limit → auth → repository
  ├── Google Places / Routes   (server-side key, field-masked)
  ├── LLM provider adapter     (swappable; intent extraction only)
  ▼
Repository port  (src/lib/data/index.ts → getRepo())
  ├── demoRepo      synthetic, labelled, offline
  └── supabaseRepo  real Postgres
  ▼
Postgres
     RLS on every table · writes only through SECURITY DEFINER RPCs
```

### The two architectural decisions that matter most

**1. Writes never touch tables.** `anon` and `authenticated` hold `SELECT`
only. Every mutation goes through a thin `public.*` wrapper that delegates to
a `private.*` `SECURITY DEFINER` function with `SET search_path TO ''` and
fully-qualified identifiers. This means authorisation, validation, versioning,
idempotency and audit-writing all happen in one place that the client cannot
bypass — even if the client is a curl command with a stolen anon key.

**2. Provenance is a column, not a comment.** Every fact table carries
`source`, `source_url`, `verified_at`, `verified_by_role`, with a CHECK that
`verified_at IS NULL ⇔ verified_by_role IS NULL`. `public.fc_fact_freshness`
unions all of them, so "how stale is this hospital's data" is a query, not a
guess.

Freshness is computed per field type against its own TTL:

| Fact | TTL | Rationale |
|---|---|---|
| Phone, scheme listings | 90 days | Change often, high cost when wrong |
| Charges, services, address, prep | 180 days | Moderately stable |
| Accessibility, languages, arrival, routes | 365 days | Physical infrastructure |

`fresh` → within TTL · `ageing` → 1–2× TTL · `stale` → beyond 2× ·
`unverified` → never checked · `live` → fetched from Google this request.

---

## 6. Feature catalogue

### 6.1 Discovery and search

| Feature | What it does | The honest bit |
|---|---|---|
| **Multi-modal search** | Name, locality, specialty, service, or natural language | Ranking is deterministic and inspectable; no hidden personalisation |
| **Nearby browse** | Distance from a located or manually-set point | Straight-line unless the Routes API is enabled — and it is labelled as such |
| **Map + list toggle** | `/hospitals/map` | Falls back to a schematic non-Google map when no browser key is set |
| **Smart filters** | Specialty, service, accessibility, scheme, emergency, language | A filter appears **only** if the underlying fact is verifiable and filterable |
| **Autocomplete** | Session-tokened Places autocomplete | Session tokens are fresh UUIDv4 per session, as the billing terms require |
| **Comparison** | Up to 4 hospitals side by side, `/hospitals/compare` | A table, never a ranking. There is no "best" column |
| **Saved hospitals** | `/hospitals/saved`, RLS-isolated | Cross-user access is covered by a live test |
| **Recently viewed** | With an explicit clear action | Stored locally, never used to re-rank silently |
| **Availability status** | Available / Limited / None / **Unknown** | 14-day window from real slots. No sessions ⇒ `unknown`. **Never** derived from opening hours |

### 6.2 Ratings and reviews

Two rating systems that are **never** combined into one number:

- **Google rating** — shown as Google's, attributed, fetched live, never stored.
- **FlowCare rating** — only from authenticated patients with an eligible
  completed visit, across five dimensions (overall, waiting, staff,
  appointment, facility).

The FlowCare aggregate (`fc-rating-v1`) is deliberately non-naive:

```
counted   = published AND verifiedVisit
recency   = clamp(0.5 ^ (ageDays / 540), 0.35, 1)
score     = (8 × 3.8 + Σ wᵢrᵢ) / (8 + Σ wᵢ)     # Bayesian prior, 8 pseudo-counts
published = counted ≥ 5, else "Not enough FlowCare reviews yet"
```

The prior stops one five-star review from outranking a hospital with fifty.
The recency weight stops a good year in 2021 from carrying 2026. The threshold
stops a score from existing before it means anything. **Review sentiment is
never converted into a medical-quality score** — the literature is explicit
that patient-reported outcomes track experience, not clinical quality (S64).

**Moderation:** report → hide/remove status → human decision → audit event.
Duplicate, spam and abuse prevention run before publication. AI may attach a
flag, a reason and a confidence — the `moderation_ai_cannot_finalise` CHECK
makes an AI-finalised decision impossible at the database level.

### 6.3 Understanding a hospital

| Feature | Detail |
|---|---|
| **Service verification** | Each claimed service carries its own evidence and date. Unverified services are shown but are **not filterable** |
| **Plain-language bridge** | 22 care needs mapped to departments, with Hindi and Marathi transliterations. Ambiguous input resolves to ≥2 departments rather than guessing |
| **Scheme listings** | Values are `listed` or `unknown` only — there is deliberately **no** `not_listed`, because absence of evidence is not evidence of absence |
| **Charges** | Per-component rows, never a single "cost" figure |
| **Accessibility** | Per-component, sourced. Given that audits find 4% accessible toilets against near-universal ramp claims, a single "accessible ✓" would be a lie |
| **Fact corrections** | Patients submit; a reviewer decides; the CHECK `correction_decision_requires_reviewer` makes self-publishing impossible. Accepted edits apply only to address fields, through explicit branches — no dynamic SQL |

### 6.4 Booking and the appointment lifecycle

Appointments run through a versioned state machine (`private.mutate_appointment`)
with optimistic concurrency (`VERSION_CONFLICT`), an idempotency ledger, and
per-hospital advisory locks. Every transition writes to `appointment_events`.

| Feature | Detail |
|---|---|
| **Handoff receipt** | `isConfirmedAppointment` is a **separate boolean** from `status`, so a `requested` row can never render as a booking. A requested appointment reads *"Waiting for the hospital to confirm. Do not travel yet."* |
| **Change policy** | States cancellability and the no-show grace period — and reports `noShowPolicyPublished: false` rather than defaulting to a number nobody promised |
| **Change watcher** | Derived from `appointment_events` plus a per-user `seen_version` watermark that never moves backwards |
| **Dependent profiles** | Book for a relative who has no account. **Not guardianship** — see below |
| **Continuity bookmark** | "Same department as last time", bound to `departments.id` by foreign key, not to a remembered name |

### 6.5 Preparing, travelling, arriving

| Feature | Detail |
|---|---|
| **Preparation requirements** | Closed `prep_code` allowlist plus a clinical blocklist. FlowCare will tell you to bring your ID; it will never tell you to fast |
| **Travel** | Mode-aware. Car and bus estimates are **never** substituted for one another — the research found an OR of 1.55 for the lowest-income × longest-bus group (S42) |
| **Arrival pack** | Entrance, registration, OPD timing, what to bring |
| **Wayfinding routes** | Schema exists; no facility has authored one yet, and the UI says exactly that |
| **Support channels** | Phone/email/website per purpose, with provenance. **26 of 60 seeded hospitals have none** — and that renders as "not connected", not as a blank field |
| **Carry list** | A what-to-bring checklist, importable from a facility's published prep requirements. **Stores no files** — there is no upload path and no storage bucket |
| **Offline visit packet** | `public.visit_packet()` assembles appointment + receipt + arrival pack + support channels + results policy + carry list into one printable document. A missing section comes back `null`, and the print view renders that as "the hospital has not published this" |

### 6.6 After the visit

| Feature | Detail |
|---|---|
| **Visit records** | Patient-owned history with a generated `expires_on = visited_on + 24 months`, filtered in RLS **and** purged by a job. This table is the most sensitive in the system and is **not delegable under any scope** |
| **Follow-up tasks** | Patient-owned, with kinds and due dates |
| **Referral tracking** | Patient-reported loop closure: open → appointment made → completed/abandoned. `source` is pinned to `patient_reported` by CHECK so it can never masquerade as a clinical referral |
| **Results delivery** | Split in two: a **facility fact** (how this department actually returns results, with provenance; absent ⇒ "not published") and a **patient preference** (what to ask for). FlowCare stores no result and promises no delivery |

### 6.7 Bring your own AI key

`/settings` lets a signed-in user store their own provider key (Gemini,
OpenAI, Groq, NVIDIA, OpenRouter, Together, Mistral) and pick a model. The
assistant then runs on their quota rather than the operator's.

| Property | How |
|---|---|
| Encrypted at rest | AES-256-GCM. The master key is a server environment variable, never in the database, so a dump alone yields nothing usable |
| Never shown again | Only the last four characters (`••••••••4f2a`) ever reach a browser |
| Never logged, never prompted | Plaintext exists only as an `Authorization` header inside the provider adapter |
| No operator access | There is no admin read path and no staff permission that grants one |
| "Working" is earned | A key is `Not checked yet` until a **real** call to the provider succeeds. Shape alone never marks it valid |
| Replacing resets trust | Saving a new key clears the previous validation result |
| Refuses to run unsafely | With no `FLOWCARE_KEY_ENCRYPTION_SECRET`, FlowCare declines to store keys rather than encrypting under a predictable secret |

### 6.8 The agentic booking workflow

Say *"book my leg appointment"* and the assistant walks you to a booking —
but it never books anything itself.

```
model ──► intent (Zod-validated, allowlisted fields only)
           │
server ────┴─► search ─► candidates ─► YOU pick ─► server builds the payload
                                                     │
you ────────────────────────── tap Confirm ──────────┤
                                                     ▼
server ──────────────────────────────────► book_appointment()
```

**The language model never writes to the database.** It produces a small
structured intent and nothing else. It does not choose the hospital, the slot
or the payload, and `confirm_agent_proposal()` takes a **proposal id, not a
payload** — verified by a test that inspects the function signature.

That shape is deliberate: if the model could supply the payload, then any text
a patient pasted in — a hospital description, a review, a forwarded message —
would become a potential instruction to book something else. Prompt injection
would be a booking primitive. As built, the worst a fully compromised model
can do is suggest a bad search.

Other guarantees: proposals expire (default 10 minutes) and expiry is
recorded; confirming twice books once via a deterministic idempotency key;
at most 5 pending proposals per user; one user cannot confirm another's; and
the result is always presented as a **request**, never a confirmed
appointment, until the hospital accepts.

**A broader emergency guard applies here than in search.** Showing a list of
hospitals is low-stakes; booking a routine outpatient slot implicitly says
"this is the right path, now wait", which is dangerous if someone is
describing something time-critical. So the agent refuses to act on phrasings
like "chest pain", "can't breathe", "seizure" or "won't stop bleeding" and
points at emergency services instead. Refusing is not triage — FlowCare is
not deciding what is wrong, it is declining to take an action.

### 6.9 Care partners — the highest-risk feature, and how it is constrained

Patients share passwords with relatives because proxy access is harder than
sharing (S08/S09). FlowCare's answer is scoped delegation.

- **Three read-only scopes**, and only three:
  `shortlist:read`, `logistics:read`, `followups:read`.
  There is no `all` scope and **no write scope** — a caregiver cannot book,
  cancel, review or correct anything.
- **`visit_records` is not delegable under any combination.** A test grants
  all three scopes and asserts it stays empty.
- **90-day ceiling by CHECK**, so an indefinite grant cannot be created even
  by a buggy caller.
- **Expiry is evaluated inside the RLS predicate**, so a lapsed grant stops
  working the instant it lapses, whether or not any cleanup job has run.
- **The invite token is never stored** — only its sha256. A database read
  cannot be replayed into someone's account.
- **Unknown and unusable tokens return the identical error**, so tokens cannot
  be enumerated.
- **The audit log belongs to the patient**, not the caregiver. The patient
  audits the caregiver; never the reverse.
- **Staff and admins gain nothing.** No membership permission grants any
  delegated access.

**Dependent profiles are deliberately not this.** A dependent profile is a
label for someone with no account — it has no `auth.users` reference,
`relationship_basis` has exactly one legal value (`self_declared`), and **no
RLS policy anywhere consults the table**. There is a live test that asserts
that count is zero. Guardianship requires a consent authority that FlowCare
does not have, and the product does not pretend otherwise.

### Running against the live database

`FLOWCARE_LIVE_READS=true` reads the facility record — hospitals, departments,
service verifications, accessibility components, arrival packs and support
channels — from the live Supabase project using the **publishable (anon) key**,
so every public read still passes through RLS. It also reads published slots
from the live `slots` table and books through the database's guarded booking
RPC. On the configured reference project, the observed snapshot is **64
published hospitals**, **2 rows marked booking-integrated**, **57 service
verifications**, **11 arrival packs**, and **26 slot rows**; these counts are
operational observations, not product guarantees.

It remains a deliberately *partial* compatibility mode, and the UI says so in
a banner on every page: FlowCare reviews are not surfaced until their live
column vocabulary is mapped, so no FlowCare ratings are shown. Care Access
requests, options, transitions, tasks and capacity signals use the additive
Supabase exchange tables and are durable when the deployment also configures
`SUPABASE_SERVICE_ROLE_KEY` for server-only system transitions. Without that
server key, public facility discovery still works but system-generated Care
Access actions fail closed rather than falling back to a local store.

`src/lib/data/liveRepo.ts` implements this split. It exists because the
original discovery portion of `supabaseRepo.ts` used a reconstructed column
vocabulary (`address_line`, `hospital_departments`, `clinic_sessions`) that
does not match the linked project's actual schema (`address`, `departments`,
`slots`). The full adapter now reuses the verified live mapper for discovery
while its Care Access methods use the additive RPC/table schema.

### Booking: requesting a slot

Discovery ends at a request, not a confirmation. `POST /api/appointments`
accepts a **session id and an optional free-text reason, and nothing else** —
the schema is `.strict()`, so a client that tries to send `status`,
`hospitalId` or its own `scheduledFor` gets a 400. Hospital, department and
time are read from the session record, which means a tampered payload cannot
request a department the hospital never published or a time it never opened.

The created row is `status: 'requested'`, and the response carries
`confirmed: false` plus a notice saying so. The receipt page and the visits
list both render that as *"Requested — waiting for the hospital to confirm"*.
FlowCare has no authority to commit a hospital to an appointment, so it never
draws one.

Capacity is enforced at creation (`booked + pending < capacity` ⇒ otherwise
409 `CAPACITY_FULL`), a closed session is refused, and a second request for
the same session by the same patient returns the original request rather than
consuming another seat. `GET /api/appointments?hospital=<slug>` lists the open
sessions the UI offers, so the interface and the tests agree on what "open"
means.

| Route | Method | Auth | Behaviour |
|---|---|---|---|
| `/api/appointments` | GET | public | Open sessions for one hospital |
| `/api/appointments` | POST | patient | Creates a `requested` appointment; 401 / 404 / 409 / 429 as appropriate |
| `/appointments/[id]` | page | owner only | Receipt; another patient gets a 404, not a 403 |

---

## 7. Data model

**Configured reference snapshot: 50 public tables, RLS enabled on all 50, 48 public policies, and 20 applied migrations.** These are schema observations, not a promise that every deployment has the same history.

```
Core          hospitals · departments · slots · appointments · visits
              memberships · membership_events · appointment_events
Discovery     hospital_external_places · hospital_favorites · discovery_events
              hospital_reviews · review_reports · review_moderation_events
Facts         hospital_service_verifications · hospital_accessibility_components
              hospital_charges · hospital_scheme_listings · hospital_language_support
              hospital_prep_requirements · hospital_arrival_packs
              hospital_wayfinding_routes · hospital_support_channels
              hospital_results_policies · facility_corrections · field_discrepancies
Patient       care_contexts · visit_records · follow_up_tasks · continuity_bookmarks
              dependent_profiles · referral_trackers · carry_items
              results_preferences · appointment_change_acks
Delegation    care_delegations · care_delegation_events
Assistant     user_ai_keys (encrypted) · agent_proposals
Infra         fc_schema_migrations · private.idempotency
```

**House style, applied without exception:**

- Status-like columns are `text` + `CHECK`. There are no enum types.
- Two default-deny layers: an event trigger auto-enables RLS on every new
  table, and `ALTER DEFAULT PRIVILEGES` grants new objects to `postgres` and
  `service_role` only — so every table needs an explicit
  `GRANT SELECT TO anon, authenticated` and every function an explicit
  `GRANT EXECUTE`, or it is simply invisible.
- Errors use a closed vocabulary, all `errcode P0001`:
  `AUTH_REQUIRED · NOT_FOUND · INVALID_INPUT · INVALID_TRANSITION ·
  VERSION_CONFLICT · BOOKING_CLOSED · CAPACITY_FULL · CONSULTATION_FULL ·
  POLICY_NOT_CONFIGURED · LAST_ADMIN · SELF_CHANGE_FORBIDDEN ·
  IDEMPOTENCY_CONFLICT · NO_ELIGIBLE_VISIT · SELF_REVIEW_FORBIDDEN ·
  ALREADY_REVIEWED · LIMIT_REACHED · INVITE_NOT_USABLE ·
  SELF_DELEGATION_FORBIDDEN`.

Migrations are additive and idempotent — no `DROP TABLE`, no `DROP COLUMN`.
The runner takes an advisory lock, records a sha256 per file, runs each file in
its own transaction, and reports checksum drift rather than silently re-running.

---

## 8. Security model

**Identity.** `private.actor()` raises `AUTH_REQUIRED` unless `auth.uid()` is
live, non-anonymous, non-banned and email-confirmed.

**Authorization.** Per-hospital `private.allowed(hospital, permission)` against
an explicit allowlist: `appointments:read · appointments:manage · queue:read ·
queue:manage · memberships:manage · reviews:moderate · facts:manage ·
corrections:review`. **There is no global admin role and no JWT role claim.**

> **A hard-won rule:** `private.allowed()` must **never** appear in an RLS
> `USING` clause. It calls `private.actor()`, which *raises* — and Postgres
> then aborts the entire `SELECT` instead of filtering it, so one hidden row
> breaks the whole public list for logged-out users. Policies use the quiet
> variants; the loud ones stay in RPCs. Neither the type-checker nor 223
> offline tests could see this. Only the live suite caught it.

**Other properties:**

- Unauthorised reads return `NOT_FOUND`. Existence is never leaked.
- Patient-owned tables have **no staff or admin read policy at all**.
- Secrets are server-side only. `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is the
  single intentional exception and must be HTTP-referrer restricted to the
  Maps JavaScript API alone.
- Analytics runs on a strict event-name allowlist. The research found 91% of
  health pages make third-party requests and 70% leak symptom terms (S68–S69);
  FlowCare sends no query text anywhere.

Full threat table in `docs/security.md`.

---

## 9. The AI assistant

`/assistant` turns a sentence into a search. It never touches the database
directly and never speaks clinically.

```
user text
  → intent extraction (LLM, or deterministic parser)
  → Zod validation against an ALLOWLIST of fields and operators
  → the ordinary, parameterised hospital search
  → candidate set
  → transparent preference matching
  → evidence trail: "Why this hospital appeared"
  → explanation
```

**Guarantees:**

- **No LLM-generated SQL.** The model emits a small JSON intent; anything
  outside the allowlist is dropped before a query is built.
- **No hallucinated hospitals.** Results come from the authoritative search
  only. A hospital the model invents cannot survive the candidate stage.
- **No diagnosis and no triage.** Symptom input is mapped to a department, not
  to a condition, and clinical content is blocked on both write paths.
- **Graceful degradation.** Zero configured providers, a timeout, an oversized
  input or a malformed response all fall back to the deterministic parser plus
  *"AI assistance is temporarily unavailable…"*. The app stays fully usable.
- **Provider-agnostic.** Gemini, OpenAI, Groq, NVIDIA, OpenRouter, Together
  and Mistral sit behind one adapter. The UI offers only providers the
  **server** reports as configured, so keys never reach the browser.

Matching is documented rather than magic (`fc-match-v1`):

```
specialty 30 · availability 22 · distance 20 · flowcareRating 12
googleRating 6 · services 4 · accessibility 3 · language 3   (PRIORITY_BOOST 1.6)
```

The percentage and the reasons behind it are both shown to the user.

---

## 10. External data and policy compliance

**Google Maps Platform.** Places API (New) is called server-side only, with a
required field mask (billing is the highest SKU in the mask). Under the Maps
Service Terms §14: **place IDs** may be stored indefinitely (refreshed beyond
12 months), **lat/lng** may be cached for ≤30 days, and **everything else must
stay live**. `PLACES_POLICY.assertPersistable()` throws if any other display
field reaches a write path, so the rule is enforced by code rather than by
memory. Attribution is mandatory, and Places results shown on a map must use a
Google map.

**OpenStreetMap.** The 60 seeded Pune hospitals come from OSM under ODbL, and
the attribution *"© OpenStreetMap contributors, ODbL"* is required wherever
they appear. OSM's `check_date` maps to `verified_at`, which gives the seed a
genuine, unmanufactured freshness spread rather than a uniform "verified
today" lie.

Imported hospitals are **discovery-only**: `booking_integrated = false`, no
departments, no slots ⇒ availability `unknown`.

**Excluded sources.** Three widely-quoted industry statistics were traced to no
primary source and are recorded in `docs/research/sources.md` Appendix A as
**not citable**.

---

## 11. Testing

```
npm test          (server running)   273 passed · 0 failed · 0 skipped  11 files
npm run test:live                     75 passed · 0 failed · 0 skipped   4 files
                                     ────────────────────────────────
                                     348 passed · 0 failed · 0 skipped
npx tsc --noEmit                      clean
npm run build:ci                      succeeds
```

| Suite | Covers |
|---|---|
| `search` (23) | Query parsing, filters, ranking, unknown-availability |
| `rating` (12) | Bayesian prior, recency, publication threshold |
| `reviews` (21) | Eligibility, duplicates, moderation, AI-cannot-finalise |
| `places` (15) | Field masks, session tokens, persistence policy, failure modes |
| `ai` (22) | Invalid intent, hallucination prevention, timeout, fallback, injection |
| `journey` (59) | Translator, prep, travel, arrival, corrections, discrepancies |
| `api.security` (34) | Cross-patient access, ownership, authz, key exposure |
| `api.journey` (37) | Journey endpoints, rate limits, caps |
| `api.booking` (7) | Slot requests: auth, strict payload, capacity, no double-book, cross-patient 404 |
| `live/rls` (21) | Real Supabase, real users, real policies |
| `live/care-partners` (22) | Scoped delegation, receipts, change watching |
| `live/continuity` (18) | Dependent profiles, referrals, results, packets |
| `keyvault` (15) | Encryption round-trip, tamper rejection, masking, refusal to run unsafely |
| `agent` (28) | Emergency guard, intent allowlist, booking-summary honesty |
| `live/agent-keys` (14) | Key isolation, proposal inertness, confirm-once, cross-user denial |

The live suites are adversarial on purpose: they try to read an ungranted
scope, replay an invite token, guess a token, self-accept an invite, revoke as
the wrong party, reach `visit_records` with every scope granted, and use a
dependent profile as a key to someone else's account.

**Two things that make test results here trustworthy:**

1. `it.runIf` evaluates at collection time, so a green run full of skips proves
   nothing. The suites are configured to fail loudly rather than skip quietly,
   and the skip count is reported above.
2. Piping test output hides the exit code. Always `set -o pipefail`.

---

## 12. Project layout

```
flowcare/
├── src/app/                 13 pages · 31 API route handlers
│   ├── hospitals/           list · [id] · map · compare · saved
│   ├── assistant/           AI hospital finder
│   ├── appointments/        list · new
│   ├── care/                care contexts, follow-ups, delegation
│   ├── visit/[id]/          visit card / offline packet
│   ├── account/             sign up / sign in
│   ├── settings/            bring-your-own AI provider keys
│   ├── admin/               moderation · corrections
│   └── api/                 every external call proxies through here
├── src/lib/
│   ├── provenance.ts        the spine: sources, TTLs, freshness
│   ├── discovery/           search, filters, ranking, comparison
│   ├── journey/             translator, prep, travel, follow-up, corrections
│   ├── places/              Google adapter + persistence policy
│   ├── ai/                  provider adapters, intent schema, fallback
│   ├── reviews/             eligibility, aggregation, moderation
│   └── data/                repository port: demoRepo | supabaseRepo
├── supabase/migrations/     0001 … 0021, additive and idempotent
├── scripts/db/              migrate · backup · seed-osm · client
├── tests/                   22 offline/API suites + live-db checks
├── docs/
│   ├── architecture.md · database.md · security.md · api.md · testing.md
│   └── research/            01–08 + sources.md (73 graded sources)
└── data/osm-pune-hospitals.json
```

---

## 13. Current status — what is actually true

This section distinguishes five different things that are often collapsed into
"it works".

| Claim | Status |
|---|---|
| **Implemented locally** | ✅ Adaptive booking/recovery, supply management, exports, adapter changes and migrations through `0021` |
| **Tested locally** | ✅ 316 offline tests passed; typecheck and production build clean |
| **Externally configured** | ✅ Configured Supabase project; 21 migrations applied; 64 published hospitals observed |
| **Externally verified** | ⚠️ **Partial** — see below |
| **Production-ready** | ❌ **Not claimed** — deployment checks remain |

**Verified against the configured Supabase project:**

- ✅ Migrations `0001`–`0021` are recorded in the remote migration ledger; `0021_adaptive_queue_operations` is applied.
- ✅ Full-repository public facility reads work with `FLOWCARE_LIVE_READS=false`;
  live search and directory return HTTP 200 instead of the former schema-mismatch
  500s.
- ✅ Live facility mode returns 64 published hospitals and 2
  booking-integrated records in the current snapshot.
- ✅ A rollback-only database smoke journey exercised request creation,
  system screening/offer, option selection, referral, hospital acknowledgement,
  acceptance, slot offer, live `book_appointment`, and Care Access booking.
- ✅ The normal authenticated RPC rejects a patient attempting the system-only
  `screen` action; system transitions are restricted to the service-role RPC.

**Not exercised here:**

- ⚠️ Authenticated HTTP Care Access against the live app: the configured
  workspace has no service-role value, so the app reports a 503 for
  server-generated system actions and fails closed rather than falling back to
  local storage. Configure `SUPABASE_SERVICE_ROLE_KEY` before production use.
- ❌ Google Places/Routes — no billable key has been exercised.
- ❌ AI providers — no provider key has been exercised against a live endpoint.
- ❌ A browser-driven live authenticated journey, load test, accessibility
  audit, or legal review of the §14.3 discrepancy-fingerprint question.

The demo path remains deterministic and fully testable; live claims above are
limited to the exact reads and rollback checks listed.

---

## 14. Known limitations

1. **Discovery data is Pune-only** — 60 hospitals from OSM, of which only 2
   test hospitals are bookable. Everything else is discovery-only by design.
2. **Adaptive recovery is an MVP, not an automation service.** Instant,
   approval-required and waitlist modes now use database-backed slots and queue
   entries. Approval expiry is processed by the Vercel Cron endpoint, so a
   deployment must set `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`; if the
   cron is not configured, no status is silently fabricated and operators must
   run the recovery endpoint through an authorized scheduler.
3. **Several features ship dark**: cross-source discrepancy detection (F16)
   awaits a legal read; travel times await a Routes key; wayfinding routes
   await a facility willing to author one.
4. **No facility has ever used the staff side in anger.** Moderation and
   correction review are implemented and tested, never operated.
5. **No patient has used any of this.** Every success metric in the research is
   unmeasured. The largest untested assumption in the whole product is that a
   digital arrival pack helps at all — the wayfinding studies establish that
   signage fails, but **no study anywhere tests whether a digital pack fixes
   it**.
6. **The third-phase bibliography (T01–T37) has not been read at source.** It
   is namespaced separately from the graded S01–S73 entries precisely so the
   weaker provenance is not mistaken for the stronger.
7. **`private.can_read_appointment()` was widened** to admit consented
   caregivers. It is additive and tested, but anyone reviewing the security
   model needs to know the read surface of `appointments`, `visits` and
   `appointment_events` changed.

---

## 15. Attribution and licensing

- Hospital seed data: **© OpenStreetMap contributors**, licensed **ODbL**.
  This attribution must appear wherever the data is displayed.
- Google Places content is fetched live, displayed with Google attribution, and
  never warehoused beyond the place ID and coordinates permitted by the Maps
  Service Terms.
- FlowCare ratings are FlowCare's own and are never presented as Google's, and
  Google ratings are never presented as FlowCare-verified.
- AI output is never presented as clinical advice.

**Deploying:** see `docs/deployment.md` — Vercel + Supabase, environment
variables, the pre-push secret check, and an honest list of what behaves
differently once hosted (notably: the in-memory rate limiter is not
multi-instance safe and must be replaced before real traffic).

**Further reading:** `docs/architecture.md` · `docs/database.md` ·
`docs/security.md` · `docs/api.md` · `docs/testing.md` ·
`docs/adaptive-operations.md` · `docs/research/` (research trail, 01–08) · `docs/research/sources.md`
(73 sources, each with URL, date, confidence grade and limitation).

## Current status

Last verified 2 October 2026. 333 tests, `tsc --noEmit` clean, production
build clean.

### Working end to end

- **Patient journey** — discovery over 62 real hospitals, map, hospital
  profiles with per-field provenance, appointment *requests*.
- **Hospital portal** at `/hospital`, and on its own hostname
  (`hospital-flowcare.vercel.app`) via a middleware rewrite. The hostname
  selects context only; it grants nothing.
- **The request → confirm loop.** Staff accept, decline, propose another
  time or cancel. Every move goes through one state machine, writes an
  appointment event, and the patient sees the result.
- **Staff standing comes from `memberships`**, not from anything the browser
  sends. No global admin exists in code, not merely in policy.
- **Hospital claims** with four ranked verification routes, including an
  automated DNS TXT check. A claim grants nothing on its own.
- **AI key checks** make one real provider call and report six distinct
  outcomes.

### Not built

The hospital sidebar marks these "Soon" rather than linking to them:
Queue, Patients, Reviews, Analytics, Hospital profile, Staff management.

Also absent: migration `0009` (a `notifications` table — notices are
currently held in the demo store), an in-app reviewer for hospital claims
(approving one means touching the database), and patient-side controls for
accepting a proposed time (the API exists and is tested; the UI does not).

### Known limitations

- **The live compatibility mode is intentionally split.** Discovery maps the
  linked project's `published`/`departments`/`slots` vocabulary, while the
  additive Care Access adapter uses the new exchange tables and RPCs. Review
  reads remain disabled until their live column vocabulary is mapped.
- **Care Access system transitions require the server-only service key.**
  `SUPABASE_SERVICE_ROLE_KEY` is intentionally blank in this workspace. The
  API reports a clear 503 and never falls back to a local Care Access store;
  direct database rollback smoke tests cover the service-role RPC path.
- **Notifications are in-app only.** No mail or SMS provider is configured
  and nothing claims otherwise.
- **Rate limiting counts in process memory**, so on serverless it is per
  warm instance rather than global.
- **Demo accounts are refused** on a production build with a real Supabase
  project unless `FLOWCARE_ALLOW_DEMO_AUTH=true`. The test harness sets it.

### Validation boundary

Verified against the configured project: migrations through `0020`, RLS and
Care Access RPC authorization, the rollback journey from request through
booking, the full-repository public facility reads, and the live slot booking
RPC. Not exercised here: authenticated HTTP Care Access with a service-role
key (the configured key is absent), Google Places, or an AI provider key.
Those are explicit deployment checks rather than evidence to invent.