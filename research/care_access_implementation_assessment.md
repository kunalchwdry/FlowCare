# FlowCare care-access implementation assessment

**Completed before code changes.**

## What already exists

- Next.js 15 App Router + TypeScript + Tailwind.
- Dual data paths:
  - `demoRepo` backed by `.data/demo-state.json` and seed fixtures.
  - `supabaseRepo` for the schema described by the migrations.
  - `liveRepo` for Supabase-backed facility reads with a local appointment layer.
- Patient discovery:
  - hospital search, filters, compare, map, favorites, external-place provenance;
  - service verification, charges, accessibility, language, schemes, arrival/preparation facts;
  - freshness/provenance display patterns already exist.
- Appointment workflow:
  - session/slot browsing;
  - patient appointment requests;
  - hospital approval/rejection;
  - cancellation, reschedule proposals, patient response;
  - check-in, in-progress, completed, no-show;
  - appointment event/audit trail and optimistic versioning;
  - appointment messages.
- Patient surfaces:
  - `/appointments`, appointment detail, `/care`, private care contexts, visit records, follow-up reminders;
  - assistant and AI/provider guardrails;
  - account/auth flows.
- Hospital/staff surfaces:
  - `/hospital` and `/staff` portals;
  - appointment/referral-like request queue, queue view, patients, messages, reviews, analytics, staff access, hospital profile;
  - hospital-scoped permissions and role/membership approval.
- Supabase security posture:
  - existing RLS-first design;
  - writes primarily through `SECURITY DEFINER` RPCs;
  - `private.actor()`, `private.allowed()`, hospital-level permissions;
  - no provider keys in browser code.
- Tests:
  - appointment state machine;
  - hospital isolation/tampering;
  - booking, journey, AI, auth, RLS/live paths and security.

## What can be reused

- Existing `Hospital`, `ClinicSession`, `Appointment`, `AppointmentEvent`, `QueueSnapshot`, `FollowUpTask`, provenance, and matching types.
- Existing slot capacity and hospital appointment transition workflow as the downstream booking layer.
- Existing `stateMachine.ts` for appointment actions; the new care-access state machine must remain separate because it represents a care request/episode, not an appointment row.
- Existing `getRepo()` abstraction for demo/live/Supabase behavior.
- Existing hospital/staff permissions: `appointments:read`, `appointments:manage`, `queue:read`, `queue:manage`, `facts:manage`, and staff management.
- Existing `HospitalShell`, `Stat`, `NoData`, `StatusBadge`, cards/buttons, and timestamp/freshness UI patterns.
- Existing AI endpoint only for structured, non-clinical extraction; Zod validation and current prompt safety boundaries.
- Existing care hub follow-up reminder functionality for personal reminders; it is not sufficient for shared hospital-owned operational tasks, so a separate care-task concept is needed.

## What needs modification

- Add a patient-facing Care Access Exchange entry point and “My Care Journey” view without replacing existing discovery or appointments.
- Add a hospital portal care-access/referral queue with explicit acknowledgement, information-request, accept, redirect, slot-offer, and closure actions.
- Add a capacity-signal publisher and freshness UI. Existing slots/queue snapshots are useful but do not cover a care-request-specific source/expiry contract.
- Extend matching from discovery-style explanations to care-request options that can be selected and audited.
- Add a care-request state machine with explicit transitions and append-only state-transition history.
- Connect a selected care option to the existing appointment request/transition flow.
- Add operational care tasks/barriers with patient/hospital ownership and deadlines.
- Add care closure metrics to the existing hospital analytics and an admin operations view.
- Add demo-mode simulated hospitals/signals and deterministic seeded journey flow.

## What is missing

- No cross-provider `care_requests`/`care_episodes` workflow object.
- No persisted care-request state machine distinct from appointment status.
- No persisted explainable option snapshot for a patient request.
- No shared hospital/patient barrier-task layer.
- No provider-facing care-request acknowledgement/redirect queue.
- No care-request closure metric.
- No document upload/vault or report-sharing system. Existing “reports” are moderation/correction reports and administrative preparation checklists; `0006`/`0007` explicitly defer a document vault. This implementation will not pretend an upload system exists or create unrestricted cross-hospital access.
- No verified external integration for live hospital capacity; demo mode must label simulated data.

## Database changes required

Additive migration only, after `0016`:

- `care_requests`: structured administrative access request plus current care state/version.
- `care_episodes`: patient-scoped linkage from a request to selected hospital/appointment and closure/follow-up fields.
- `care_access_options`: time-stamped explainable shortlist snapshots.
- `hospital_capacity_signals`: published capacity/queue signals with `source`, `updated_at`, `expires_at`.
- `care_state_transitions`: append-only request-transition audit history.
- `care_tasks`: shared operational barrier/follow-up tasks with owner, status, deadline, and resolution.
- RLS and `SECURITY DEFINER` RPCs for request creation, state transitions, option selection, capacity publishing, and task updates.
- No duplicate `hospital_capabilities`, `appointments`, `appointment_slots`, or `documents` tables; existing service verification, department/session/slot, appointment, and fact systems remain the source of truth where applicable.

## UI changes required

- `/care-access`: patient request form, structured request preview, explainable options, freshness labels, select/referral action.
- `/care-journeys`: patient timeline with current state and next action.
- `/hospital/care-access`: staff referral queue, request details, acknowledgement/accept/info-request/redirect actions, capacity signal controls.
- Existing `/appointments/[id]` and `/care` can link into a selected request/episode.
- `/admin/care-access`: network-level care closure, acknowledgement/booking times, unresolved requests, stale capacity.
- `/hospital/care-access`: hospital-scoped queue metrics and simulated-data labels.

## API changes required

- Patient:
  - `POST /api/care-requests`
  - `GET /api/care-requests`
  - `GET /api/care-requests/[id]`
  - `POST /api/care-requests/[id]/options/[optionId]/select`
  - `POST /api/care-requests/[id]/transition`
  - `POST /api/care-requests/[id]/tasks`
  - `PATCH /api/care-tasks/[id]`
- Hospital:
  - `GET /api/hospital/care-requests`
  - `POST /api/hospital/care-requests/[id]/transition`
  - `POST /api/hospital/capacity-signals`
- Admin/operations:
  - `GET /api/admin/care-access/metrics`

All routes must validate with Zod, enforce session/hospital scope, and call repository methods/RPCs rather than writing arbitrary SQL.

## Implementation boundary

The MVP will implement the workflow in demo mode and make the Supabase path migration/RPC-ready. It will not claim live hospital integration, clinical urgency classification, diagnosis, autonomous referral decisions, fabricated price/availability, production document storage, or national-scale interoperability.

## Post-implementation verification (2026-10-03)

The implementation is now present in the paths listed above. The configured
Supabase project has migrations `0017_care_access_exchange` through
`0020_care_access_system_claim_scope` applied, with `0001`–`0020` synchronized
in the remote ledger. The Care Access RPC path was exercised in a rollback-only
live database journey from request creation through live slot booking; no test
rows were retained.

Two production boundaries remain explicit:

1. `SUPABASE_SERVICE_ROLE_KEY` is blank in the validation workspace. Public
   facility reads work, but server-generated system transitions fail closed
   with HTTP 503 until a deployment provides that server-only value.
2. Live facility compatibility is mapped to the linked project's actual
   `published`/`departments`/`slots` schema. Review reads remain disabled until
   their live column vocabulary is mapped. No live capacity, price, clinical,
   or outcome claim is inferred from missing data.
