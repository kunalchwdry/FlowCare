
---

## Migration 0006 — care partners, receipts, change watching

Applied 2026-09-27. Live state after: **33 tables, RLS on all 33, 31 policies,
6 migrations.** Full rationale in `docs/research/08-third-phase-gap-analysis.md`.

### New tables

| Table | Owner | Purpose |
|---|---|---|
| `care_delegations` | patient | A revocable, expiring, read-only grant of named scopes to one other account |
| `care_delegation_events` | patient | Append-only audit of `invited / accepted / revoked / declined / expired`. Readable by the **patient**, never the caregiver |
| `continuity_bookmarks` | patient | "Same department as last time", FK-bound to `departments.id` |
| `appointment_change_acks` | patient/caregiver | Per-user `seen_version` watermark over `appointment_events` |
| `hospital_support_channels` | facility fact | Phone/email/website per purpose, with the standard 4 provenance columns |

### `care_delegations` invariants

Enforced in the schema, not in application code:

- `delegation_scope_allowlist` — every element of `scopes` ∈
  `{shortlist:read, logistics:read, followups:read}`. All read-only; there is
  no write scope and no `all` scope.
- `delegation_scope_count` — 1 ≤ `cardinality(scopes)` ≤ 3.
- `delegation_max_window` — `expires_at <= created_at + 90 days`. An
  indefinite grant cannot be created.
- `delegation_future_expiry` — `expires_at > created_at`.
- `delegation_not_self` — `caregiver_id <> patient_id`.
- `care_delegations_live_uniq` — partial unique index capping live
  delegations, with the predicate restated for `ON CONFLICT`.
- `invite_hash` stores a **sha256 only**. The token itself is returned once by
  `invite_care_partner()` and never persisted.

### Changed core function

`private.can_read_appointment(uuid)` was replaced via `create or replace`.
The original three branches (owner, hospital staff with `appointments:read`,
service_role) are reproduced **verbatim**; a fourth branch was appended for an
active, unexpired delegation holding `logistics:read`. This widens the read
surface of `appointments`, `visits` and `appointment_events` — see
`docs/security.md`.

### Replaced read policies

`care_contexts_owner` → `care_contexts_read`, `favorites_owner` →
`favorites_read`, `follow_up_owner` → `follow_up_read`. The old policy names
no longer exist. Each new policy is `owner OR private.delegated_quiet(owner_id, '<scope>')`.

`visit_records` was **not** extended and is not delegable under any scope.

### New RPCs

`invite_care_partner · accept_care_invite · close_care_delegation ·
appointment_receipt · appointment_changes · ack_appointment_changes ·
set_continuity_bookmark` — all thin `public` wrappers over `private`
SECURITY DEFINER functions with `SET search_path TO ''`, each with an explicit
`GRANT EXECUTE TO authenticated`.

---

## Migration 0007 — continuity, referrals, results, packets

Applied 2026-09-27. Live state after: **38 tables, RLS on all 38, 36 policies,
40 public functions, 7 migrations.**

| Table | Owner | Purpose |
|---|---|---|
| `dependent_profiles` | patient | A booking label for a person with no account. **Not guardianship**: no `auth.users` reference, `relationship_basis` has one legal value, no RLS policy consults it |
| `referral_trackers` | patient | Patient-reported referral loop closure; `source` pinned to `patient_reported` by CHECK |
| `carry_items` | patient | What-to-bring checklist. **No file storage** — no upload path, no bucket |
| `results_preferences` | patient | Stated preference for how results are returned |
| `hospital_results_policies` | facility fact | How a department returns results, with the standard 4 provenance columns. Absent row ⇒ "not published" |

New column: `appointments.booked_for_profile_id` (nullable, `on delete set
null`). `patient_name` is copied at attach time so the appointment stands alone
if the profile is later deleted.

All four patient-owned tables are **owner-only** and are deliberately *not*
added to the F03 delegation scope allowlist, which stays at three read scopes.

New RPCs: `upsert_dependent_profile · delete_dependent_profile ·
attach_dependent_profile · upsert_referral · delete_referral ·
set_results_preference · set_carry_item · import_facility_carry_items ·
visit_packet`.

**Idempotency fix in 0006.** 0006's policy replacements used `drop policy if
exists <old>; create policy <new>`, which fails on replay. The runner verifies
idempotency by replaying every migration, so this broke the 0007 dry run. Both
names are now dropped first; 0006 was re-applied via the checksum-drift path
(recorded `2e0ab14e4b06c997` → `32e43aa012240535`).
