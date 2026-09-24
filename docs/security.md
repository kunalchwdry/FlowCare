
---

## Scoped care delegation (migration 0006)

This is the only feature in FlowCare that deliberately lets one account read
another account's data. It is therefore the highest-risk surface in the
product and is constrained accordingly.

**Threat model and mitigations**

| Threat | Mitigation | Test |
|---|---|---|
| Caregiver reads more than granted | Scope checked per-table inside each RLS policy via `private.delegated_quiet(owner, scope)` | `shortlist:read grants the shortlist and NOTHING else` |
| Caregiver reads medical history | `visit_records` has no delegation branch at all | `visit_records is never delegable, under any scope combination` |
| Grant outlives its purpose | `expires_at` capped at 90 days by CHECK **and** evaluated inside the RLS predicate, so lapse is immediate and needs no job | `expiry cuts access with no job having run` |
| Patient cannot get out | `close_care_delegation(..., 'revoke')`, effective on the next statement | `revocation cuts access immediately` |
| Caregiver trapped in a grant | `close_care_delegation(..., 'decline')` — the caregiver can leave unilaterally | `a caregiver can step away without the patient acting` |
| Token stolen from the database | Only sha256 is stored | `an invite returns its token exactly once and stores only a hash` |
| Token replayed | Single-use; status leaves `pending` on accept | `a token cannot be replayed after it has been accepted` |
| Token brute-forced / enumerated | 24 random bytes from `gen_random_bytes`; unknown and unusable tokens return the identical `INVITE_NOT_USABLE` | `a bad token is indistinguishable from an unusable one` |
| Self-granting | `delegation_not_self` CHECK + `SELF_DELEGATION_FORBIDDEN` | `the patient cannot accept their own invite` |
| Wrong party ends the grant | Revoke is patient-only, decline is caregiver-only; the other gets `NOT_FOUND` | `a caregiver cannot revoke on the patient's behalf, and vice versa` |
| Staff/admin ride the feature | No membership permission grants any delegated access | `a stranger sees none of it` |
| Caregiver surveils the patient | `care_delegation_events` is readable by the **patient** only | `the access log is the patient's, not the caregiver's` |

**Deliberately absent:** write scopes, an `all` scope, indefinite grants,
inferred guardianship (see `08-third-phase-gap-analysis.md` §4.1), and any
staff-side view of patient-owned tables.

**Known widening:** `private.can_read_appointment()` now has a fourth branch.
A caregiver with `logistics:read` can read the patient's `appointments`,
`visits` and `appointment_events` rows for the duration of the grant.
