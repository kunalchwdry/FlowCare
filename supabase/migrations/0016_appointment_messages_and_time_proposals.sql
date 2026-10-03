-- 0016_appointment_messages_and_time_proposals.sql
--
-- Patient and hospital appointment conversation, including a hospital
-- suggested time that the patient must explicitly accept or decline.
-- The existing appointment status remains requested/confirmed while a
-- proposal is pending; the application derives reschedule_proposed from the
-- pending message so this does not weaken the live status CHECK constraint.

create table if not exists public.appointment_messages (
  id                 uuid primary key default gen_random_uuid(),
  appointment_id     uuid not null references public.appointments(id) on delete cascade,
  sender_id          uuid not null references auth.users(id) on delete restrict,
  sender_side        text not null check (sender_side in ('patient','hospital')),
  kind               text not null check (kind in ('message','time_proposal','time_response')),
  body               text not null check (length(btrim(body)) between 1 and 1000),
  proposed_slot_id   uuid references public.slots(id) on delete restrict,
  proposed_for       timestamptz,
  previous_status    text,
  proposal_status    text check (proposal_status is null or proposal_status in ('pending','accepted','declined')),
  created_at         timestamptz not null default clock_timestamp()
);

create index if not exists appointment_messages_appointment_idx
  on public.appointment_messages (appointment_id, created_at);

create index if not exists appointment_messages_pending_proposal_idx
  on public.appointment_messages (appointment_id, created_at desc)
  where kind = 'time_proposal' and proposal_status = 'pending';

alter table public.appointment_messages enable row level security;

grant select, insert on public.appointment_messages to authenticated;

-- Both sides can read only messages attached to an appointment they can
-- already read. The existing appointment policy remains the authorization
-- boundary; this table does not create a second, weaker one.
drop policy if exists appointment_messages_read on public.appointment_messages;
create policy appointment_messages_read
  on public.appointment_messages for select to authenticated
  using (private.can_read_appointment(appointment_id));

-- Ordinary messages are inserted through the app with the authenticated
-- caller's id. Time proposals and responses are inserted by the SECURITY
-- DEFINER functions below, which also enforce version, capacity and role.
drop policy if exists appointment_messages_insert on public.appointment_messages;
create policy appointment_messages_insert
  on public.appointment_messages for insert to authenticated
  with check (
    kind = 'message'
    and sender_id = private.actor()
    and (
      (sender_side = 'patient' and exists (
        select 1 from public.appointments a
        where a.id = appointment_id and a.patient_id = private.actor()
      ))
      or
      (sender_side = 'hospital' and exists (
        select 1 from public.appointments a
        where a.id = appointment_id
          and private.allowed(a.hospital_id, 'appointments:manage')
      ))
    )
  );

-- A hospital proposes a new slot without moving the patient's current
-- appointment. The patient must answer through respond_appointment_time.
create or replace function private.propose_appointment_time(
  p_id uuid,
  p_version integer,
  p_slot uuid,
  p_key text,
  p_message text
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  actor uuid := private.actor();
  a public.appointments;
  s public.slots;
  d public.departments;
  previous private.idempotency;
  payload jsonb := jsonb_build_array('propose_time', p_id, p_slot, p_message, p_version);
  result jsonb;
begin
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[a-zA-Z0-9_-]+$'
     or p_id is null or p_slot is null or p_version is null or p_version < 1
     or p_message is null or length(btrim(p_message)) not between 1 and 1000 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;

  insert into private.idempotency(actor_id, key, request)
  values (actor, p_key, payload)
  on conflict do nothing;
  select * into previous from private.idempotency where actor_id = actor and key = p_key for update;
  if previous.request <> payload then
    raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT';
  end if;
  if previous.response is not null then return previous.response; end if;

  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  perform private.require_permission(a.hospital_id, 'appointments:manage');
  if a.status not in ('requested','confirmed') then
    raise exception using errcode='P0001', message='INVALID_TRANSITION';
  end if;
  if exists (
    select 1 from public.visits v
    where v.appointment_id = a.id and v.state in ('waiting','consultation','completed')
  ) then
    raise exception using errcode='P0001', message='INVALID_TRANSITION';
  end if;
  if exists (
    select 1 from public.appointment_messages m
    where m.appointment_id = a.id and m.kind = 'time_proposal' and m.proposal_status = 'pending'
  ) then
    raise exception using errcode='P0001', message='INVALID_TRANSITION';
  end if;
  if a.version <> p_version then
    raise exception using errcode='P0001', message='VERSION_CONFLICT';
  end if;

  select * into s from public.slots where id = p_slot and department_id = a.department_id for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  select * into d from public.departments where id = a.department_id for update;
  if not d.booking_open or not s.booking_open or not private.hospital_public(a.hospital_id)
     or s.ends_at <= clock_timestamp() then
    raise exception using errcode='P0001', message='BOOKING_CLOSED';
  end if;
  if (select count(*) from public.appointments
      where slot_id = s.id and status not in ('cancelled','denied','no_show') and id <> a.id) >= s.capacity then
    raise exception using errcode='P0001', message='CAPACITY_FULL';
  end if;

  insert into public.appointment_messages(
    appointment_id, sender_id, sender_side, kind, body,
    proposed_slot_id, proposed_for, previous_status, proposal_status
  ) values (
    a.id, actor, 'hospital', 'time_proposal', btrim(p_message),
    s.id, s.starts_at, a.status, 'pending'
  );

  update public.appointments
     set version = version + 1
   where id = a.id
   returning * into a;

  insert into public.appointment_events(appointment_id, actor_id, action, version, details)
  values (
    a.id, actor, 'propose_reschedule', a.version,
    jsonb_build_object('slotId', s.id, 'status', a.status, 'message', btrim(p_message))
  );

  result := to_jsonb(a);
  update private.idempotency set response = result where actor_id = actor and key = p_key;
  return result;
end
$$;

create or replace function public.propose_appointment_time(
  p_id uuid, p_version integer, p_slot uuid, p_key text, p_message text
)
returns jsonb language sql set search_path to ''
as $$ select private.propose_appointment_time(p_id, p_version, p_slot, p_key, p_message) $$;

grant execute on function public.propose_appointment_time(uuid, integer, uuid, text, text) to authenticated;

-- The patient answers the latest pending proposal. Declining keeps the
-- original appointment time; accepting moves the appointment only after the
-- target slot is capacity-checked again.
create or replace function private.respond_appointment_time(
  p_id uuid,
  p_version integer,
  p_accept boolean,
  p_key text,
  p_message text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  actor uuid := private.actor();
  a public.appointments;
  proposal public.appointment_messages;
  s public.slots;
  previous private.idempotency;
  payload jsonb := jsonb_build_array('respond_time', p_id, p_accept, p_message, p_version);
  result jsonb;
  response_body text;
begin
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[a-zA-Z0-9_-]+$'
     or p_id is null or p_version is null or p_version < 1 or p_accept is null then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;

  insert into private.idempotency(actor_id, key, request)
  values (actor, p_key, payload)
  on conflict do nothing;
  select * into previous from private.idempotency where actor_id = actor and key = p_key for update;
  if previous.request <> payload then
    raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT';
  end if;
  if previous.response is not null then return previous.response; end if;

  select * into a from public.appointments where id = p_id for update;
  if not found or a.patient_id <> actor then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if a.version <> p_version then
    raise exception using errcode='P0001', message='VERSION_CONFLICT';
  end if;

  select * into proposal
    from public.appointment_messages
   where appointment_id = a.id and kind = 'time_proposal' and proposal_status = 'pending'
   order by created_at desc
   limit 1
   for update;
  if not found then raise exception using errcode='P0001', message='INVALID_TRANSITION'; end if;

  if p_accept then
    select * into s from public.slots
     where id = proposal.proposed_slot_id and department_id = a.department_id for update;
    if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
    if not s.booking_open or s.ends_at <= clock_timestamp() then
      raise exception using errcode='P0001', message='BOOKING_CLOSED';
    end if;
    if (select count(*) from public.appointments
        where slot_id = s.id and status not in ('cancelled','denied','no_show') and id <> a.id) >= s.capacity then
      raise exception using errcode='P0001', message='CAPACITY_FULL';
    end if;
    update public.appointments
       set slot_id = s.id, status = 'confirmed', version = version + 1
     where id = a.id
     returning * into a;
    response_body := 'I accepted the hospital''s suggested time.';
  else
    update public.appointments
       set version = version + 1
     where id = a.id
     returning * into a;
    response_body := 'I declined the hospital''s suggested time and kept the original appointment.';
  end if;

  update public.appointment_messages
     set proposal_status = case when p_accept then 'accepted' else 'declined' end
   where id = proposal.id;

  insert into public.appointment_messages(
    appointment_id, sender_id, sender_side, kind, body,
    proposed_slot_id, proposed_for, previous_status, proposal_status
  ) values (
    a.id, actor, 'patient', 'time_response',
    coalesce(nullif(btrim(p_message), ''), response_body),
    proposal.proposed_slot_id, proposal.proposed_for, proposal.previous_status,
    case when p_accept then 'accepted' else 'declined' end
  );

  insert into public.appointment_events(appointment_id, actor_id, action, version, details)
  values (
    a.id, actor, case when p_accept then 'accept_reschedule' else 'decline_reschedule' end,
    a.version,
    jsonb_build_object('slotId', a.slot_id, 'status', a.status, 'message', coalesce(nullif(btrim(p_message), ''), response_body))
  );

  result := to_jsonb(a);
  update private.idempotency set response = result where actor_id = actor and key = p_key;
  return result;
end
$$;

create or replace function public.respond_appointment_time(
  p_id uuid, p_version integer, p_accept boolean, p_key text, p_message text default null
)
returns jsonb language sql set search_path to ''
as $$ select private.respond_appointment_time(p_id, p_version, p_accept, p_key, p_message) $$;

grant execute on function public.respond_appointment_time(uuid, integer, boolean, text, text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0016_appointment_messages_and_time_proposals')
on conflict (version) do nothing;
