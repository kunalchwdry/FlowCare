# FlowCare — verified fact sheet for the deck

Everything below is checked against the repo and the live database. Use only
this when filling slides. If a slide wants something not on this list, the
honest answer is to leave it out — see §6.

---

## 1. One-liner options (pick one, use it everywhere)

- "FlowCare helps people find a hospital they can actually get an appointment
  at, and shows where every fact on the screen came from."
- "A hospital discovery and appointment app built around one rule: never show
  a fact without its source and date."

## 2. The problem (all figures have graded sources in `docs/research/sources.md`)

| Claim | Figure | Source |
|---|---|---|
| Provider directories are wrong | 48.7% of 10,504 locations had ≥1 inaccuracy | S01 (CMS Round 3) |
| Being listed ≠ bookable | appointment obtainable 18% of the time | S03 (Senate secret shopper) |
| Ratings don't discriminate | poor correlation below ~15 reviews; ~34% unreviewed | S62–S64 |
| Scheme confusion | 96.6% knew PM-JAY, 30.3% knew which hospitals accept it | S49 (Meerut) |
| Signage fails | 91% couldn't reach their destination unaided (n=45) | S19 (Odisha) |
| Accessibility gap | 35 govt hospitals: overall 32.6%, accessible toilets 4.0% | S25 (PwD-led audit) |
| Recall | 40–80% of medical info forgotten immediately | S35 (Kessels) |

**73 sources**, each graded A/B/C/D with URL, date and limitation.
Three commonly-quoted industry stats were traced to **no primary source** and
are listed as not citable (Appendix A). Mentioning that we excluded them is a
credibility point, not a weakness.

## 3. What is actually built

| Number | What |
|---|---|
| 15 | pages |
| 39 | API route handlers |
| 22 | React components |
| 40 | database tables, RLS enabled on all 40 |
| 38 | RLS policies |
| 8 | migrations, additive and idempotent |
| 341 | tests passing, 0 skipped (266 offline + 75 live against real Supabase) |
| 60 | real Pune hospitals seeded from OpenStreetMap (ODbL) |
| 63 | support channels seeded — and 26 hospitals have none, shown as "not connected" |

Stack: Next.js 15 App Router · TypeScript · Tailwind · Supabase (Postgres +
Auth + RLS) · Zod · Vitest. Deploy target Vercel (`bom1`, Mumbai).

## 4. The four things that make it technically interesting

Pick 2–4 depending on slide count. These are the defensible ones.

1. **Provenance is a column, not a comment.** Every fact carries
   `source`, `source_url`, `verified_at`, `verified_by_role`, with per-field
   TTLs (phone 90d, charges 180d, accessibility 365d). `fc_fact_freshness`
   makes "how stale is this hospital" a query. There is deliberately **no
   aggregate trust score**.

2. **Writes never touch tables.** `anon`/`authenticated` hold SELECT only.
   Every mutation goes through a `SECURITY DEFINER` RPC with
   `search_path = ''`. Authorization, versioning, idempotency and audit all
   happen in one place a client cannot bypass.

3. **The LLM never writes to the database.** It emits a Zod-validated intent;
   the server searches, the user picks, the server builds the payload, the
   user confirms. `confirm_agent_proposal()` takes a **proposal id, not a
   payload** — so prompt injection can't become a booking primitive.

4. **Scoped care delegation.** Three read-only scopes, 90-day ceiling enforced
   by CHECK, expiry evaluated *inside* the RLS predicate so revocation is
   instant without a cleanup job, sha256-only invite tokens, and
   `visit_records` non-delegable under any scope combination.

## 5. Demo-able flows

1. Search → filter → compare → hospital profile with per-fact provenance chips.
2. "book my leg appointment" → agent proposes → **you confirm** → request sent
   (shown as a *request*, never a confirmation).
3. `/settings` → paste your own Gemini/OpenAI key → "Test key" makes a real
   provider call → status becomes Working.
4. Invite a care partner with `shortlist:read` → they see the shortlist and
   nothing else; revoke → access stops immediately.

## 6. Do NOT claim (there is no evidence for any of these)

- ❌ Any user count, hospital partnership, pilot, or testimonial. **Zero
  patients and zero hospitals have used this.**
- ❌ Revenue, market size, or funding.
- ❌ That Google Places / any AI provider has been exercised with a live key.
  The plumbing is tested; no billable key has been run through it.
- ❌ That discovery runs on the live database. `supabaseRepo.ts` is unported,
  so hospital discovery still reads demo data.
- ❌ "Production-ready." It is not, and the README says so.
- ❌ Any accuracy/satisfaction/time-saved improvement. Nothing has been measured.

## 7. Honest framing that still lands well

- "341 tests, zero skipped — including 75 that run against the real database
  and try to break the permission model."
- "Two of those tests caught real bugs in my own code this week: expired
  booking suggestions were never marked expired, and 'chest pain can't
  breathe' wasn't being treated as an emergency."
- "Built and tested; not deployed to users. The next blocker is porting the
  repository layer so discovery reads the live database."
- "The research banded four features as infeasible. I re-checked and found
  that was about a different codebase — so I built five of them."

## 8. Terminology — keep consistent

| Use | Not |
|---|---|
| hospital | clinic, facility, provider |
| appointment **request** | booking confirmation |
| care partner / delegation | caregiver access, sharing |
| fact freshness / provenance | trust score, verification score |
| assistant / agent | chatbot, AI doctor |
| discovery-only hospital | unlisted, inactive |
