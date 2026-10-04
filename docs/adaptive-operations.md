# Adaptive operations MVP

## What the patient sees

At `/care-access`, a patient can create an administrative care request and choose only an observed future slot. Each option displays:

- hospital and department capability;
- dated availability with source/freshness;
- booking mode: instant, hospital approval, or waitlist;
- an explainable reason list, without clinical prioritisation.

After selection, the journey retains a human-readable Queue ID. Approval-required requests show their approval deadline. Waitlisted requests show their queue position as informational, not as a clinical rank. Expired approvals move to recovery rather than disappearing.

## What hospital staff see

Approved hospital users can use:

- `/hospital/care-access` for incoming requests and state transitions;
- `/hospital/operations` for departments, services, providers, schedules, slots, capacity, booking mode, and queue rules;
- `/hospital/queue` for hospital-scoped queue entries with masked phone data by default;
- `/api/hospital/exports?format=csv` or `format=xlsx` for minimum-necessary operational exports.

Phone visibility requires the explicit queue-management permission and an authorized request. Export access is separately permissioned and written to `audit_events`.

## What administrators need to configure

Production requires these server-side Vercel variables:

- `SUPABASE_SERVICE_ROLE_KEY` — enables service-generated approval expiry and recovery transitions;
- `CRON_SECRET` — authorizes `/api/cron/care-recovery`;
- existing Supabase URL and anon key variables.

The migration is `supabase/migrations/0021_adaptive_queue_operations.sql`. It extends the existing departments, slots, appointments, memberships, Care Access, and audit infrastructure; it does not create duplicate equivalents.

## Demo flow

1. Open `/care-access` and create an access request.
2. Select an option whose card shows the observed slot and booking mode.
3. Confirm the Queue ID and, for approval-required mode, the approval deadline.
4. Open the hospital portal and inspect the request in Care Access.
5. Use Operations to publish or inspect capacity-backed slots.
6. Download a CSV or XLSX queue export and verify that an export audit event is created.

The public live deployment currently reads real facility and slot data. It does not claim approval or recovery automation until the service-role key and cron secret are configured.
