# The journey layer (F1–F20)

How the twenty features from `docs/research/02-feature-opportunities.md` are
actually built, and — more importantly — which invariants hold them up.

This document is written for the next person to change this code. Every
"never" below is enforced somewhere real (a type, a CHECK constraint, a test),
and the enforcement point is named. If you are about to relax one of them,
the test that fails will tell you which promise you are breaking.

---

## 1. The one idea everything else hangs off: F18

A hospital directory is not wrong in the abstract. It is wrong **one field at
a time**, at different rates. The phone number rots in months; the location of
the accessible toilet does not. The research is blunt about the consequence:
CMS Round 3 audited 10,504 locations and found 48.74% carried at least one
inaccuracy (S01).

So FlowCare does not have a "verified" badge on a hospital. It has a
provenance record on **every fact**:

```ts
interface Provenance {
  source: 'flowcare_field_check' | 'hospital_confirmed' | 'hospital_published'
        | 'official_registry'    | 'user_reported_pending' | 'google_live';
  sourceUrl: string | null;
  verifiedAt: string | null;   // null = nobody ever checked
  verifiedByRole: string | null;
}
```

`lib/provenance.ts` turns that into one of four states against a **per-field**
TTL (`FACT_TTL_DAYS`: phone 90 days, accessibility 365, and so on):

| State | Meaning | UI |
|---|---|---|
| `fresh` | checked within the field's TTL | green |
| `ageing` | 1–2× TTL | amber, "checked a while ago" |
| `stale` | > 2× TTL | red, "may be out of date" |
| `unverified` | `verifiedAt === null` | grey, "nobody has checked this" |
| `live` | Google, this request only | blue, no date |

**Three things this module deliberately does not do.**

1. **No aggregate trust score.** `summariseFreshness()` returns counts and a
   median age. It does not return a grade. Collapsing eleven accessibility
   components and a phone number into "87% trustworthy" recreates exactly the
   composite-number problem the ratings work spent so long avoiding.
2. **Never renders unverified as fresh.** A missing date is a *state*, not a
   default. This is the single most likely regression, which is why it is the
   first assertion in `tests/journey.test.ts`.
3. **Never claims a guarantee.** The chip tooltip says "verified means a
   person checked on this date", not "verified means correct".

The TTL numbers are a **starting position, not measured truth**. Experiment E1
(a repeat secret-shopper audit at 6 and 12 months) exists to replace them with
an observed decay rate. Until it runs, treat them as an assumption.

---

## 2. Feature-by-feature invariants

### F1 — Care Need Translator (`lib/journey/translator.ts`)

Lay words → departments. A static, reviewed dictionary.

- **No LLM at query time.** It runs on every keystroke and an invented
  department is a safety failure, not a UX blemish.
- **An ambiguous term must return ≥ 2 departments.** Returning one department
  for "chest pain" is indistinguishable from triage. Enforced across the whole
  dictionary by a test, not per-entry by hand.
- Every department carries a human-readable reason, so the list is never an
  unexplained ranking.
- Emergency wording surfaces a non-dismissible "call 108" notice **and still
  returns results** — suppressing them would be its own harm.

### F2 — Service verification (`lib/data/facts.ts`, `factsView.ts`)

A service is filterable only when confirmed **at this address**.
`isFilterableVerification()` is the gate: a `user_reported_pending` row shows
on the profile, labelled, and never matches a filter. A patient who travels
for an MRI that is not there has lost a day.

### F3 — Care contexts (`api/care-contexts`)

No relationship field, no age, no condition — those are clinical inference
vectors (§9.1). The label is free text, so it is screened by the **same
clinical blocklist** that guards preparation content.

### F4 — Scheme listings

`listing_status` is an enum of `listed | unknown`. **There is no
`not_listed`.** Absence of evidence is not evidence of absence, and telling a
patient a hospital does not take their scheme when nobody checked is the more
harmful error. `SCHEME_CAVEAT` ("listed is not cashless") ships attached to
the data, not to whoever remembers to render it — S52 records 1.1 lakh
grievances, 74% of them hospitals demanding money from entitled beneficiaries.

### F5 — Charges

Transcribed from what the hospital publishes. Never estimated, never
predicted. When a hospital publishes nothing the panel says so rather than
guessing.

### F6 — Mode-aware reachability (`lib/journey/travel.ts`)

- **Never substitutes one mode's time for another.** S42 (51,580 visits) found
  car and bus estimates are not interchangeable; sorting by straight-line
  distance silently ranks for people who drive.
- When routing is unconfigured it returns `minutes: null` and a straight-line
  **distance**. A straight line is a real fact about geography; a
  straight-line *duration* is a fabrication.
- Results are `no-store` and never persisted.

### F7 — Accessibility components

Eleven separate observable components, each with a status against a named
Indian standard (Harmonised Guidelines 2021, RPwD Act 2016). **Never collapsed
into a score.** A DB CHECK enforces that an unverified row can only be
`not_assessed`. The research is the argument: one audit found 90% of PHCs had
a ramp and *zero* had an accessible toilet (S24), so a single "wheelchair
accessible" boolean is actively misleading.

### F8 — Language support per stage

Tracked per workflow stage, not per hospital, and the UI highlights where
support **drops** between consultation and the registration counter. That gap
is where the visit actually fails.

### F9 — Preparation checklist (`lib/journey/prep.ts`)

Documents and payments only. The `CLINICAL_BLOCKLIST` rejects fasting
instructions, dosages, medication changes and implied diagnoses.

Enforced in **three** places: at seed build time, at the repository boundary
in *both* repo implementations, and in the correction workflow. A CI test
asserts that no seeded preparation string anywhere contains clinical content.

"Come fasting" is the single most requested preparation string and it is a
clinical instruction: fasting is unsafe for some diabetic patients, and
FlowCare does not know who is diabetic (and by §9.1 must never know).

### F11 — Offline visit card (`api/hospitals/[id]/visit-card`)

**Zero Google content.** No photo, no rating, no Google-sourced address, no
map tile. An offline card is by definition stored on a device, and Maps
Service Terms §14.3 forbids storing that content. The API asserts
`containsGoogleContent: false` and a test greps the raw response body for
Google-shaped fields.

### F13 / F14 — Arrival timing and late policy

Process facts only ("the case paper queue commonly runs 45–60 minutes at this
site"). **No predicted wait.** There is no column for one in the schema, and a
test scans the seed for predictive phrasing. A 2025 RCT found posting waits
produced no satisfaction gain (S65–S67), so no such claim is made.

### F16 — Discrepancy detector (`lib/journey/discrepancy.ts`) — **SHIPS DARK**

Stores salted one-way fingerprints, never values. `assertHashable()` restricts
comparison to `phone | address | hours` — short factual fields, excluding
anything plausibly "content".

It is **off unless an operator sets both a feature flag and a salt**, because
the question *"is a salted hash of a Google value itself content under §14.3?"*
has not been answered by counsel. The endpoint returns `enabled: false` with
that reason rather than 404ing: an honestly-disabled feature is a deployable
state, a silent absence is not.

### F17 — Correction workflow (`lib/journey/corrections.ts`)

**A user report never changes what another user sees.** Enforced at three
depths:

1. `createCorrection()` in both repos forces status to `pending`/`duplicate`.
2. `assertReviewed()` throws unless status is `confirmed` **and** a named
   reviewer exists.
3. A DB CHECK (`correction_decision_requires_reviewer`) makes a decided row
   without a reviewer and timestamp unrepresentable.

The reviewer UI has no bulk action and no AI recommendation, matching the
moderation stance elsewhere: a machine may flag, a person decides.

### F19 — Visit records

Where and when only. Retention is 24 months, enforced **on every read** as
well as by a scheduled function, so a missing cron job degrades to "swept on
next use" rather than "never".

### F20 — Follow-up tasks

Closed enum, no free text — a note field becomes a clinical record the moment
someone types "recheck the biopsy". **FlowCare never generates a task.** The
patient records what they were told; inventing a care instruction is worse
than forgetting one. Copy implies no urgency or consequence, because S12 found
the SMS-reminder subgroup effect was not statistically significant.

---

## 3. Data model

Thirteen new tables in `supabase/migrations/0003_journey.sql`, in two groups.

**Facility facts** (public read, admin write) each carry the same four
provenance columns. Columns, not a JSONB blob: *"show me every fact nobody has
checked in a year"* is the query this product lives on, and it must be an
index scan. `fc_fact_freshness` is a view unioning all of them.

**Patient-owned** (`care_contexts`, `visit_records`, `follow_up_tasks`) are
RLS-scoped to `auth.uid()` with **no admin read policy** — a visit history is
not moderation material, so no legitimate admin read path exists and none is
granted.

The migration contains zero `DROP` statements and is idempotent.

---

## 4. Test map

| Area | File | What it protects |
|---|---|---|
| Provenance states, TTL per field | `tests/journey.test.ts` | F18 never shows unverified as fresh |
| Translator dictionary sweep | `tests/journey.test.ts` | every ambiguous term ≥ 2 departments |
| Clinical blocklist + seed sweep | `tests/journey.test.ts` | no medical advice reaches storage |
| Fixture coverage | `tests/journey.test.ts` | all four freshness states exist per fact type |
| Cross-patient isolation | `tests/api.journey.test.ts` | contexts/visits/reminders are owner-only |
| Correction workflow | `tests/api.journey.test.ts` | nothing self-publishes; admin-only review |
| Visit card | `tests/api.journey.test.ts` | no Google content in the payload |

See `docs/testing.md` for how to run them and what is *not* covered.
