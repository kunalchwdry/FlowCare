# Patient Traffic

FlowCare Patient Traffic is an aggregate of **today's existing appointment and queue records**. It is not road traffic, GPS traffic, a driving ETA, or an external traffic service.

## State mapping

The mapping follows `src/lib/appointments/stateMachine.ts` and the live database event trail:

- `booked` and `checked_in` → waiting
- `in_progress` → in consultation
- `completed`, `cancelled`, `rejected`, `no_show` → not active
- `requested` and `reschedule_proposed` → not active

The live database stores check-in and consultation as `appointment_events` while the appointment row remains `confirmed`. The traffic RPC and live repository derive the app-level state from the latest event; they do not create another appointment state machine.

## Thresholds

`src/lib/traffic/traffic.ts` is the single source of truth:

- LOW: 0–5 waiting
- MODERATE: 6–15 waiting
- HIGH: 16 or more waiting
- Traffic snapshots and queue estimates are considered stale after 15 minutes.
- A stale traffic snapshot is shown as **Traffic unavailable**, not downgraded to LOW.
- An ETA above 240 minutes is not accepted as reliable.

These values are intentionally centralized in `TRAFFIC_THRESHOLDS`. A change should be made there and covered by the traffic tests, not in a portal component.

## ETA rule

FlowCare shows an estimated wait only when current queue rows provide an explicit `estimated_slot_at` and every contributing row has a recent `last_updated_at`. It does not derive a wait from a patient count, appointment spacing, a guessed service rate, or random/demo queue numbers. Otherwise it renders **Wait time unavailable**.

## Privacy and scope

`public.list_patient_traffic(uuid)` is a `SECURITY DEFINER` aggregate function:

- public callers can see an aggregate only for published hospitals;
- queue readers can see department and provider aggregates only for their own authorised hospital, and only when those records exist;
- no patient id, patient name, appointment id, provider identity, medical data, or individual appointment row is returned.

Discovery cards use one batched traffic read for the page. The existing client has no Realtime subscription, so the discovery page and traffic panels use a one-minute refresh strategy. The refresh endpoint still delegates scope decisions to the repository/RPC.
