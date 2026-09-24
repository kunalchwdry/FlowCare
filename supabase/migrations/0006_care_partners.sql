-- ===========================================================================
-- 0006_care_partners.sql — caregiver delegation, handoff receipts,
-- change watching, continuity bookmarks, verified support channels
-- ===========================================================================
-- Implements the feasible subset of the third-phase research document
-- (docs/research/08-third-phase-gap-analysis.md):
--
--   F03 Caregiver workspace with scoped delegation   -> care_delegations
--   F07 Appointment handoff receipt                  -> public.appointment_receipt()
--   F12 Appointment change & integrity watcher       -> public.appointment_changes()
--                                                       + appointment_change_acks
--   F13 Missed/late recovery (read-only policy view) -> folded into the receipt
--   F21 Continuity bookmark                          -> continuity_bookmarks
--   F10 Human assistance channels                    -> hospital_support_channels
--
-- The research banded F03/F04/F07/F12/F21 as "High effort — requires existing
-- auth, consent, audit and a real scheduler", because it audited a MERN
-- fixture build with none of those. The real FlowCare has all of them:
-- private.actor(), memberships, appointment_events with monotonic versions,
-- private.mutate_appointment() and an idempotency ledger. Those features are
-- therefore feasible here, and this migration builds them on the existing
-- primitives rather than beside them.
--
-- F04 (dependent/guardian mode) is deliberately NOT implemented. It requires
-- a legal guardianship determination, and the research is explicit that
-- guardianship must never be inferred. There is no consent authority in this
-- system to establish it, so building it would mean faking it.
--
-- F14/F16/F17 (referral loop, document vault, results delivery) are NOT
-- implemented: FlowCare has no referral, document or results system, and the
-- research forbids presenting fixtures as if those records existed.
--
-- Additive and idempotent. No DROP TABLE, no DROP COLUMN.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. F03 — scoped, time-bounded, revocable caregiver delegation
-- ---------------------------------------------------------------------------
-- Design constraints taken directly from the research (S08, S09):
--   * patients share credentials because proxy setup is harder than sharing a
--     password, so acceptance must be one step for the caregiver;
--   * patients do NOT want caregivers to see everything, so scope is an
--     explicit allowlist and there is no "all" value;
--   * every scope here is READ-ONLY. A caregiver cannot book, cancel, review,
--     submit a correction or change anything. Write delegation is a separate
--     decision that needs its own consent language.
--
-- The invite token is never stored. Only its sha256 is kept, so a database
-- read cannot be replayed into someone else's account.

create table if not exists public.care_delegations (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references auth.users(id) on delete restrict,
  caregiver_id    uuid references auth.users(id) on delete restrict,
  invite_hash     text not null check (invite_hash ~ '^[0-9a-f]{64}$'),
  label           text check (label is null or length(btrim(label)) between 1 and 80),
  scopes          text[] not null,
  status          text not null default 'pending'
                  check (status in ('pending','active','revoked','declined')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default clock_timestamp(),
  accepted_at     timestamptz,
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete restrict,

  -- least privilege: at least one scope, never more than the allowlist
  constraint delegation_scopes_nonempty check (cardinality(scopes) between 1 and 3),
  constraint delegation_scopes_allowlist check (
    scopes <@ array['shortlist:read','logistics:read','followups:read']::text[]
  ),
  -- a caregiver is attached exactly when the invite has been accepted
  constraint delegation_accept_pair check ((status = 'pending') = (caregiver_id is null)
                                            or status in ('revoked','declined')),
  constraint delegation_accepted_at check ((accepted_at is not null) = (status = 'active')),
  constraint delegation_closed_pair check ((closed_at is null) = (closed_by is null)),
  -- nobody may delegate to themselves
  constraint delegation_no_self check (caregiver_id is null or caregiver_id <> patient_id),
  -- hard ceiling on duration; an indefinite delegation is not a delegation
  constraint delegation_max_window check (expires_at <= created_at + interval '90 days'),
  constraint delegation_future_expiry check (expires_at > created_at)
);

create unique index if not exists care_delegations_invite_key on public.care_delegations (invite_hash);
create index if not exists care_delegations_patient_idx   on public.care_delegations (patient_id, status);
create index if not exists care_delegations_caregiver_idx on public.care_delegations (caregiver_id, status)
  where caregiver_id is not null;

comment on table public.care_delegations is
  'F03. Every scope is read-only and explicitly enumerated; there is no "all" scope and no write scope. Expiry is capped at 90 days by CHECK, so an indefinite grant cannot be created even by a buggy caller. The invite token itself is never stored — only its sha256 — so reading this table does not let you impersonate an invitation.';

create table if not exists public.care_delegation_events (
  id            bigint generated always as identity primary key,
  delegation_id uuid not null references public.care_delegations(id) on delete restrict,
  actor_id      uuid references auth.users(id) on delete restrict,
  action        text not null check (action in ('invited','accepted','declined','revoked','expired','accessed')),
  occurred_at   timestamptz not null default clock_timestamp(),
  details       jsonb not null default '{}'::jsonb
);
create index if not exists care_delegation_events_idx
  on public.care_delegation_events (delegation_id, occurred_at desc);

-- The RLS-safe predicate. Note it checks expiry on every evaluation, so an
-- expired delegation stops granting access the moment it lapses, whether or
-- not any job has run to mark it so.
create or replace function private.delegated_quiet(p_patient uuid, p_scope text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.care_delegations d
        where d.patient_id   = p_patient
          and d.caregiver_id = auth.uid()
          and d.status       = 'active'
          and d.expires_at   > now()
          and p_scope = any (d.scopes)
     );
$$;

comment on function private.delegated_quiet is
  'F03 access predicate for RLS. Quiet like private.allowed_quiet(): returns false rather than raising, so an unauthenticated reader simply sees fewer rows.';

-- ---------------------------------------------------------------------------
-- 2. Extend the patient-owned read policies to consented caregivers
-- ---------------------------------------------------------------------------
-- 0003 deliberately gave these tables NO policy beyond the owner. That is
-- still true for staff and admins — there is no staff route to this data. The
-- only addition is a caregiver the patient explicitly and revocably invited.
--
-- visit_records is NOT extended. Personal visit history is not in the
-- research's scope list ("shortlist, preparation, appointment logistics,
-- follow-up tasks"), so it stays owner-only.

drop policy if exists care_contexts_owner on public.care_contexts;
-- also drop the NEW name: this migration must be replayable, which the
-- migration runner relies on when re-applying after checksum drift.
drop policy if exists care_contexts_read on public.care_contexts;
create policy care_contexts_read on public.care_contexts
  for select to authenticated
  using (
    (auth.uid() is not null and owner_id = auth.uid())
    or private.delegated_quiet(owner_id, 'shortlist:read')
  );

drop policy if exists favorites_owner on public.hospital_favorites;
-- also drop the NEW name: this migration must be replayable, which the
-- migration runner relies on when re-applying after checksum drift.
drop policy if exists favorites_read on public.hospital_favorites;
create policy favorites_read on public.hospital_favorites
  for select to authenticated
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or private.delegated_quiet(user_id, 'shortlist:read')
  );

drop policy if exists follow_up_owner on public.follow_up_tasks;
-- also drop the NEW name: this migration must be replayable, which the
-- migration runner relies on when re-applying after checksum drift.
drop policy if exists follow_up_read on public.follow_up_tasks;
create policy follow_up_read on public.follow_up_tasks
  for select to authenticated
  using (
    (auth.uid() is not null and owner_id = auth.uid())
    or private.delegated_quiet(owner_id, 'followups:read')
  );

-- Appointment logistics. This REPLACES a core function, so the original
-- behaviour is reproduced verbatim and the delegation branch is appended.
-- Patient, appointments:read staff and queue:read staff all keep exactly the
-- access they had.
create or replace function private.can_read_appointment(p_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists(
    select 1 from public.appointments a
     where a.id = p_id
       and ( a.patient_id = private.actor()
          or private.allowed(a.hospital_id, 'appointments:read')
          or private.allowed(a.hospital_id, 'queue:read')
          or private.delegated_quiet(a.patient_id, 'logistics:read') ));
$$;

comment on function private.can_read_appointment is
  'Core read predicate for appointments, visits and appointment_events. 0006 appended the F03 caregiver branch; the patient and staff branches are unchanged from the Phase-1 definition.';

-- ---------------------------------------------------------------------------
-- 3. F21 — continuity bookmark (a department, not just a hospital)
-- ---------------------------------------------------------------------------
-- The research point (S01, S06, S07) is that follow-up care needs the SAME
-- department, and a hospital name is not a stable enough identity for that.
-- departments.id is a stable uuid, so this is a FK, not a string.
create table if not exists public.continuity_bookmarks (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete restrict,
  hospital_id   uuid not null references public.hospitals(id) on delete restrict,
  department_id uuid references public.departments(id) on delete restrict,
  label         text check (label is null or length(btrim(label)) between 1 and 120),
  last_seen_on  date,
  created_at    timestamptz not null default clock_timestamp(),
  unique (owner_id, hospital_id, department_id)
);
create index if not exists continuity_bookmarks_owner_idx
  on public.continuity_bookmarks (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. F12 — acknowledgement watermark for appointment changes
-- ---------------------------------------------------------------------------
-- The change feed itself is DERIVED from appointment_events, which already
-- records every transition with a monotonic version. No second copy of
-- scheduler state is created here; only "how much has this person seen".
create table if not exists public.appointment_change_acks (
  appointment_id   uuid not null references public.appointments(id) on delete restrict,
  user_id          uuid not null references auth.users(id) on delete restrict,
  seen_version     integer not null check (seen_version > 0),
  updated_at       timestamptz not null default clock_timestamp(),
  primary key (appointment_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. F10 — verified human-assistance channels
-- ---------------------------------------------------------------------------
-- The research is blunt: "Never fabricate phone/WhatsApp/interpretation
-- support." So this table holds only channels that came from a named source,
-- carries the standard four provenance columns, and the API contract is that
-- an absent row renders as "not connected" rather than as a blank.
create table if not exists public.hospital_support_channels (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id) on delete restrict,
  purpose      text not null check (purpose in
                 ('general','registration','scheme_desk','interpreter','accessibility')),
  channel_type text not null check (channel_type in ('phone','email','website','desk')),
  value        text not null check (length(btrim(value)) between 3 and 300),
  languages    text[] not null default '{}',
  hours_note   text check (hours_note is null or length(btrim(hours_note)) <= 300),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint support_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  unique (hospital_id, purpose, channel_type)
);
create index if not exists support_channels_hospital_idx
  on public.hospital_support_channels (hospital_id);
create index if not exists support_channels_freshness
  on public.hospital_support_channels (verified_at nulls first);

comment on table public.hospital_support_channels is
  'F10. A missing row means "FlowCare has no verified channel", which the UI must render as "not connected" — never as an empty phone field and never as an invented number. No response-time SLA column exists, because FlowCare has no contract with any hospital that would make one true.';

-- ---------------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------------
grant select on public.care_delegations           to authenticated;
grant select on public.care_delegation_events     to authenticated;
grant select on public.continuity_bookmarks       to authenticated;
grant select on public.appointment_change_acks    to authenticated;
grant select on public.hospital_support_channels  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.care_delegations          enable row level security;
alter table public.care_delegation_events    enable row level security;
alter table public.continuity_bookmarks      enable row level security;
alter table public.appointment_change_acks   enable row level security;
alter table public.hospital_support_channels enable row level security;

-- Both sides of a delegation can see it. Nobody else — including staff.
do $$ begin
  create policy care_delegations_read on public.care_delegations
    for select to authenticated
    using (auth.uid() is not null
           and (patient_id = auth.uid() or caregiver_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- The access log is visible to the patient. A caregiver cannot audit the
-- patient; the patient audits the caregiver.
do $$ begin
  create policy care_delegation_events_read on public.care_delegation_events
    for select to authenticated
    using (exists (select 1 from public.care_delegations d
                    where d.id = delegation_id
                      and auth.uid() is not null
                      and d.patient_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy continuity_bookmarks_read on public.continuity_bookmarks
    for select to authenticated
    using ((auth.uid() is not null and owner_id = auth.uid())
           or private.delegated_quiet(owner_id, 'shortlist:read'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy change_acks_owner on public.appointment_change_acks
    for select to authenticated
    using (auth.uid() is not null and user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy support_channels_public on public.hospital_support_channels
    for select to anon, authenticated
    using (private.hospital_public(hospital_id));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 8. F03 write RPCs
-- ---------------------------------------------------------------------------
-- Returns the invite token ONCE, in the response. It is never stored and
-- cannot be retrieved again.
create or replace function private.invite_care_partner(
  p_label text, p_scopes text[], p_days int)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  actor uuid := private.actor();
  token text;
  d public.care_delegations;
begin
  if p_scopes is null or cardinality(p_scopes) = 0 or cardinality(p_scopes) > 3
     or not (p_scopes <@ array['shortlist:read','logistics:read','followups:read']::text[]) then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if p_days is null or p_days not between 1 and 90 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  -- a person cannot accumulate unlimited live delegations
  if (select count(*) from public.care_delegations
       where patient_id = actor and status in ('pending','active') and expires_at > now()) >= 5 then
    raise exception using errcode='P0001', message='LIMIT_REACHED';
  end if;

  token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.care_delegations
    (patient_id, invite_hash, label, scopes, expires_at)
  values
    (actor, encode(extensions.digest(token, 'sha256'), 'hex'),
     nullif(btrim(p_label), ''), p_scopes,
     clock_timestamp() + make_interval(days => p_days))
  returning * into d;

  insert into public.care_delegation_events(delegation_id, actor_id, action, details)
  values (d.id, actor, 'invited', jsonb_build_object('scopes', d.scopes, 'days', p_days));

  -- token is returned exactly once, here
  return jsonb_build_object(
    'id', d.id, 'scopes', d.scopes, 'status', d.status,
    'expiresAt', d.expires_at, 'inviteToken', token);
end $$;

create or replace function public.invite_care_partner(
  p_scopes text[], p_days int default 30, p_label text default null)
returns jsonb language sql set search_path to ''
as $$ select private.invite_care_partner(p_label, p_scopes, p_days) $$;

create or replace function private.accept_care_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); d public.care_delegations; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into d from public.care_delegations where invite_hash = h for update;
  -- Same error for "no such invite" and "not usable": an attacker must not be
  -- able to enumerate valid tokens by comparing responses.
  if not found or d.status <> 'pending' or d.expires_at <= now() then
    raise exception using errcode='P0001', message='INVITE_NOT_USABLE';
  end if;
  if d.patient_id = actor then
    raise exception using errcode='P0001', message='SELF_DELEGATION_FORBIDDEN';
  end if;

  update public.care_delegations
     set caregiver_id = actor, status = 'active', accepted_at = clock_timestamp()
   where id = d.id returning * into d;

  insert into public.care_delegation_events(delegation_id, actor_id, action)
  values (d.id, actor, 'accepted');

  return to_jsonb(d);
end $$;

create or replace function public.accept_care_invite(p_token text)
returns jsonb language sql set search_path to ''
as $$ select private.accept_care_invite(p_token) $$;

-- Either side can end it. The patient revokes; the caregiver declines/steps
-- away. Both are recorded with an accountable actor.
create or replace function private.close_care_delegation(p_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); d public.care_delegations;
begin
  if p_action is null or p_action not in ('revoke','decline') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  select * into d from public.care_delegations where id = p_id for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;

  if p_action = 'revoke' and d.patient_id <> actor then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if p_action = 'decline' and coalesce(d.caregiver_id, '00000000-0000-0000-0000-000000000000'::uuid) <> actor then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if d.status in ('revoked','declined') then
    return to_jsonb(d);
  end if;

  update public.care_delegations
     set status = case when p_action = 'revoke' then 'revoked' else 'declined' end,
         accepted_at = null,
         closed_at = clock_timestamp(), closed_by = actor
   where id = p_id returning * into d;

  insert into public.care_delegation_events(delegation_id, actor_id, action)
  values (d.id, actor, case when p_action = 'revoke' then 'revoked' else 'declined' end);

  return to_jsonb(d);
end $$;

create or replace function public.close_care_delegation(p_id uuid, p_action text default 'revoke')
returns jsonb language sql set search_path to ''
as $$ select private.close_care_delegation(p_id, p_action) $$;

-- ---------------------------------------------------------------------------
-- 9. F07 — handoff receipt, derived from the scheduler, never duplicated
-- ---------------------------------------------------------------------------
-- The research requires: never label an unaccepted request as an appointment;
-- show who owns the next step; state the change policy; and do not stand up a
-- second scheduler. This reads the real tables and computes nothing that the
-- scheduler has not already decided.
create or replace function private.appointment_receipt(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare a public.appointments; s public.slots; d public.departments;
        h public.hospitals; v public.visits; nxt text; owner text;
begin
  if not private.can_read_appointment(p_id) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  select * into a from public.appointments where id = p_id;
  select * into s from public.slots       where id = a.slot_id;
  select * into d from public.departments where id = a.department_id;
  select * into h from public.hospitals   where id = a.hospital_id;
  select * into v from public.visits      where appointment_id = a.id;

  -- Next action and its owner. 'requested' is explicitly NOT an appointment.
  case a.status
    when 'requested' then nxt := 'Waiting for the hospital to confirm. Do not travel yet.';
                          owner := 'hospital';
    when 'confirmed' then nxt := 'Confirmed. Arrive in time for registration and check in at the desk.';
                          owner := 'patient';
    when 'denied'    then nxt := 'The hospital did not accept this request. Choose another slot.';
                          owner := 'patient';
    when 'cancelled' then nxt := 'Cancelled. Nothing further is scheduled.'; owner := 'none';
    when 'no_show'   then nxt := 'Recorded as not attended. You can book again.'; owner := 'patient';
    when 'completed' then nxt := 'Visit completed. You can add it to your history or leave a review.';
                          owner := 'patient';
    else nxt := 'Unknown'; owner := 'none';
  end case;

  return jsonb_build_object(
    'appointmentId', a.id,
    'isConfirmedAppointment', a.status = 'confirmed',
    'status', a.status,
    'version', a.version,
    'requestedAt', a.created_at,
    'patientName', a.patient_name,
    'hospital', jsonb_build_object('id', h.id, 'name', h.name, 'timezone', h.timezone,
                                   'address', h.address, 'phone', h.phone),
    'department', jsonb_build_object('id', d.id, 'name', d.name),
    'slot', jsonb_build_object('id', s.id, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'kind', s.kind),
    'visitState', coalesce(v.state, 'not_checked_in'),
    'nextAction', nxt,
    'nextActionOwner', owner,
    -- F13: the recovery policy, stated rather than implied
    'changePolicy', jsonb_build_object(
        'canCancel', a.status in ('requested','confirmed') and (v.id is null or v.state = 'waiting'),
        'canReschedule', a.status in ('requested','confirmed') and v.id is null,
        'noShowGraceMinutes', d.no_show_grace_minutes,
        'noShowPolicyPublished', d.no_show_grace_minutes is not null),
    'schedulerSource', 'flowcare-core',
    'issuedAt', now());
end $$;

create or replace function public.appointment_receipt(p_id uuid)
returns jsonb language sql stable set search_path to ''
as $$ select private.appointment_receipt(p_id) $$;

-- ---------------------------------------------------------------------------
-- 10. F12 — what changed since the patient last looked
-- ---------------------------------------------------------------------------
create or replace function private.appointment_changes(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare actor uuid := private.actor(); seen int; items jsonb;
begin
  if not private.can_read_appointment(p_id) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  select coalesce(max(seen_version), 0) into seen
    from public.appointment_change_acks where appointment_id = p_id and user_id = actor;

  select coalesce(jsonb_agg(jsonb_build_object(
           'version', e.version, 'action', e.action,
           'occurredAt', e.occurred_at,
           'status', e.details->>'status',
           'slotId', e.details->>'slotId',
           'isNew', e.version > seen
         ) order by e.version), '[]'::jsonb)
    into items
    from public.appointment_events e
   where e.appointment_id = p_id;

  return jsonb_build_object(
    'appointmentId', p_id,
    'lastSeenVersion', seen,
    'unseenCount', (select count(*) from public.appointment_events e
                     where e.appointment_id = p_id and e.version > seen),
    'changes', items);
end $$;

create or replace function public.appointment_changes(p_id uuid)
returns jsonb language sql stable set search_path to ''
as $$ select private.appointment_changes(p_id) $$;

create or replace function private.ack_appointment_changes(p_id uuid, p_version int)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor();
begin
  if p_version is null or p_version < 1 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not private.can_read_appointment(p_id) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  insert into public.appointment_change_acks(appointment_id, user_id, seen_version)
  values (p_id, actor, p_version)
  on conflict (appointment_id, user_id) do update
     set seen_version = greatest(appointment_change_acks.seen_version, excluded.seen_version),
         updated_at = clock_timestamp();
  return jsonb_build_object('appointmentId', p_id, 'seenVersion', p_version);
end $$;

create or replace function public.ack_appointment_changes(p_id uuid, p_version int)
returns jsonb language sql set search_path to ''
as $$ select private.ack_appointment_changes(p_id, p_version) $$;

-- ---------------------------------------------------------------------------
-- 11. F21 write RPC
-- ---------------------------------------------------------------------------
create or replace function private.set_continuity_bookmark(
  p_hospital uuid, p_department uuid, p_label text, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); b public.continuity_bookmarks;
begin
  if p_hospital is null or p_on is null then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not private.hospital_public(p_hospital) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if p_department is not null and not exists (
       select 1 from public.departments where id = p_department and hospital_id = p_hospital) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;

  if not p_on then
    delete from public.continuity_bookmarks
     where owner_id = actor and hospital_id = p_hospital
       and department_id is not distinct from p_department;
    return jsonb_build_object('saved', false);
  end if;

  insert into public.continuity_bookmarks(owner_id, hospital_id, department_id, label)
  values (actor, p_hospital, p_department, nullif(btrim(p_label), ''))
  on conflict (owner_id, hospital_id, department_id) do update set label = excluded.label
  returning * into b;
  return to_jsonb(b);
end $$;

create or replace function public.set_continuity_bookmark(
  p_hospital uuid, p_department uuid default null,
  p_label text default null, p_on boolean default true)
returns jsonb language sql set search_path to ''
as $$ select private.set_continuity_bookmark(p_hospital, p_department, p_label, p_on) $$;

-- ---------------------------------------------------------------------------
-- 12. Function grants
-- ---------------------------------------------------------------------------
grant execute on function public.invite_care_partner(text[],int,text)       to authenticated;
grant execute on function public.accept_care_invite(text)                   to authenticated;
grant execute on function public.close_care_delegation(uuid,text)           to authenticated;
grant execute on function public.appointment_receipt(uuid)                  to authenticated;
grant execute on function public.appointment_changes(uuid)                  to authenticated;
grant execute on function public.ack_appointment_changes(uuid,int)          to authenticated;
grant execute on function public.set_continuity_bookmark(uuid,uuid,text,boolean) to authenticated;

insert into public.fc_schema_migrations(version) values ('0006_care_partners')
  on conflict (version) do nothing;
