# Patient Reliability and Verified Visit History

Migration `0026_patient_reliability.sql` adds the reliability projection without
creating a second appointment system. It materializes the current points and
`updated_at` in `patient_reliability_scores`, while preserving an appointment-
and event-derived fallback for data created before the migration is applied.

## Source of truth

- Official `appointment_events` actions are the write trigger: `complete`,
  `cancel`, and `no_show`.
- The database never creates a no-show because a scheduled time passed.
- Existing completed/no-show appointment outcomes are read as a migration-era
  fallback when their reliability event has not yet been materialised.
- `patient_reliability_events` is immutable from browser roles and has a unique
  `(appointment_id, event_type)` key. Its trigger uses `on conflict do nothing`
  so retries cannot deduct twice.

## Rules

The central policy starts at 100 and clamps to 0–100:

- completed/attended: +1, which is neutral at the 100-point ceiling;
- normal cancellation: 0;
- official cancellation within 24 hours of a known slot: -3;
- official no-show transition: -10 per appointment.

Repeated real no-shows therefore lower the score progressively. Thresholds are
Excellent (90+), Good (75–89), Needs improvement (50–74), and Low standing
(under 50). The database function is the live policy surface; the TypeScript
rule object mirrors it for demo derivation and presentation only.

## History and authorization

Verified visit history is derived from completed appointment/visit state and is
only where/when data: appointment id, hospital, department, slot date, and slot
kind. It is separate from patient-entered `visit_records`, which remains an
editable personal continuity log.

- Patients can read their own score, point history, and complete verified visit
  history through `get_patient_reliability` and `get_patient_visit_history`.
- Hospital staff can read only a limited recent completed-visit summary at
  that same hospital and an aggregate score through
  `get_hospital_patient_profile`, whose only input is an appointment id and
  which checks `private.allowed(..., 'appointments:read')`.
- Hospital output excludes point history and clinical content. There is no
  global patient-id search and no client write path for scores or history.

The demo repository applies the same event/status rules and relationship check
is performed by the hospital page/API before loading the profile.
