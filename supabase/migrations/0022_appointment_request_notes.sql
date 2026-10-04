/*
  0022_appointment_request_notes.sql

  A patient can explain what they are asking the hospital for when they
  request a published slot. The live booking RPC previously accepted only the
  slot, patient name and idempotency key, so the UI's reason was silently
  discarded in the live database even though the demo repository retained it.

  This extends the existing appointments row and booking RPC. It does not
  create a second request or messaging system.
*/

begin;

alter table public.appointments
  add column if not exists request_note text;

alter table public.appointments
  drop constraint if exists appointments_request_note_check;
alter table public.appointments
  add constraint appointments_request_note_check
  check (request_note is null or length(btrim(request_note)) between 1 and 280);

-- Keep the original three-argument function for older clients. New clients
-- call the four-argument overload below so the note is written atomically with
-- the appointment and cannot be lost between two requests.
create or replace function private.book_appointment_v2(
  p_slot uuid,
  p_name text,
  p_key text,
  p_request_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := private.actor();
  s public.slots;
  d public.departments;
  a public.appointments;
  q text;
  st text;
  deadline timestamptz;
  result jsonb;
  previous private.idempotency;
  -- Keep the same idempotency payload as the original RPC. A retry of an
  -- already-created booking must return that booking rather than conflict
  -- merely because the client now includes a note.
  payload jsonb := jsonb_build_array('book', p_slot, p_name);
begin
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[a-zA-Z0-9_-]+$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if p_request_note is not null and length(btrim(p_request_note)) > 280 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select * into s from public.slots where id = p_slot for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  select * into d from public.departments where id = s.department_id for update;
  if not d.booking_open
     or not s.booking_open
     or not private.hospital_public(d.hospital_id)
     or s.ends_at <= clock_timestamp()
     or (s.kind = 'appointment' and s.starts_at <= clock_timestamp()) then
    raise exception using errcode = 'P0001', message = 'BOOKING_CLOSED';
  end if;
  if s.slot_type = 'waitlist' then
    raise exception using errcode = 'P0001', message = 'WAITLIST_REQUIRED';
  end if;
  if (select count(*) from public.appointments where slot_id = s.id and status not in ('cancelled','denied','no_show')) >= s.capacity then
    raise exception using errcode = 'P0001', message = 'CAPACITY_FULL';
  end if;

  insert into private.idempotency(actor_id, key, request)
    values (actor, p_key, payload)
    on conflict do nothing;
  select * into previous
    from private.idempotency
   where actor_id = actor and key = p_key
   for update;
  if previous.request <> payload then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if previous.response is not null then
    return previous.response;
  end if;

  st := s.slot_type;
  deadline := case
    when st = 'approval_required' then clock_timestamp() + make_interval(mins => s.approval_response_window_minutes)
    else null
  end;
  q := private.next_queue_id(s.department_id);

  insert into public.appointments(
    hospital_id, department_id, slot_id, patient_id, patient_name, request_note,
    status, queue_id, slot_type, approval_status, approval_deadline, patient_phone
  ) values (
    d.hospital_id, d.id, s.id, actor, trim(p_name), nullif(btrim(p_request_note), ''),
    case when st = 'instant' then 'confirmed' else 'requested' end,
    q, st, case when st = 'instant' then 'not_required' else 'pending' end,
    deadline, (select nullif(phone, '') from auth.users where id = actor)
  ) returning * into a;

  insert into public.queue_entries(
    queue_id, appointment_id, patient_id, hospital_id, department_id,
    provider_id, slot_id, queue_type, status, position, estimated_slot_at
  ) values (
    q, a.id, actor, d.hospital_id, d.id, s.provider_id, s.id, 'appointment',
    case when st = 'instant' then 'booked' else 'approval_pending' end, null, s.starts_at
  );

  insert into public.appointment_events(appointment_id, actor_id, action, version, details)
    values (
      a.id, actor, 'book', a.version,
      jsonb_build_object('slotId', a.slot_id, 'status', a.status, 'queueId', q, 'slotType', st)
    );

  result := to_jsonb(a);
  update private.idempotency set response = result where actor_id = actor and key = p_key;
  return result;
end;
$function$;

create or replace function public.book_appointment(
  p_slot uuid,
  p_name text,
  p_key text,
  p_request_note text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.book_appointment_v2(p_slot, p_name, p_key, p_request_note)
$function$;

grant execute on function public.book_appointment(uuid, text, text, text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0022_appointment_request_notes')
  on conflict (version) do nothing;

commit;
