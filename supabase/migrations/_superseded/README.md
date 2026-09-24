# Superseded migrations — do not run

## `0001_flowcare_core.sql`

Written before any credentials existed, from the written spec alone. It tried to
**create** a FlowCare core that already existed, and it guessed the shape wrong.

Against the real project it fails:

```
ERROR 42703: column "city" does not exist
  at: create index hospitals_city_idx on public.hospitals (lower(city))
```

because the real `public.hospitals` is `(id, name, timezone, published)`. The
preceding `create table if not exists public.hospitals (...)` was silently
skipped — which is exactly what made the failure surface several statements
later at an unrelated line.

It also modelled the wrong architecture throughout: `hospital_departments` and
`clinic_sessions` duplicating the real `departments` and `slots`, an
`audit_events` table duplicating `appointment_events`/`membership_events`, and
JWT-claim helpers `fc_role()` / `fc_is_admin()` that contradict the real
membership-based `private.allowed()` model.

Replaced by `0001_core_baseline.sql`, which asserts the core instead of
creating it. Kept here only as a record of what was assumed before the live
schema could be read. See `docs/research/06-live-schema-audit.md`.
