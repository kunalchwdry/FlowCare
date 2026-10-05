/*
  0023_care_access_booking_truth.sql

  A published "instant" slot is still a patient request until hospital staff
  accept the appointment. Keep the appointment and Care Access state machines
  aligned: request -> hospital accept -> confirmed/booked.
*/

begin;

create or replace function private.care_transition_allowed(p_from text, p_action text, p_actor text)
returns text language plpgsql immutable set search_path = '' as $function$
declare v_to text;
begin
  v_to := case
    when p_action='screen' and p_from='REQUESTED' and p_actor='system' then 'SCREENED'
    when p_action='offer_options' and p_from='SCREENED' and p_actor='system' then 'OPTIONS_OFFERED'
    when p_action='select_option' and p_from in ('OPTIONS_OFFERED','RECOVERY_OPTIONS_AVAILABLE') and p_actor='patient' then 'PATIENT_SELECTED'
    when p_action='submit_referral' and p_from in ('PATIENT_SELECTED','SLOT_OFFERED','RESCHEDULED','REBOOKED') and p_actor in ('patient','system') then 'REFERRAL_SUBMITTED'
    when p_action='request_approval' and p_from in ('PATIENT_SELECTED','REFERRAL_SUBMITTED') and p_actor in ('patient','system') then 'APPROVAL_PENDING'
    when p_action='approve' and p_from='APPROVAL_PENDING' and p_actor='hospital' then 'APPROVED'
    when p_action='expire_approval' and p_from='APPROVAL_PENDING' and p_actor='system' then 'APPROVAL_EXPIRED'
    when p_action='reject' and p_from in ('APPROVAL_PENDING','ACKNOWLEDGED','ACCEPTED') and p_actor='hospital' then 'REJECTED'
    when p_action='acknowledge' and p_from in ('REFERRAL_SUBMITTED','APPROVAL_PENDING','INFO_REQUESTED') and p_actor='hospital' then 'ACKNOWLEDGED'
    when p_action='request_info' and p_from in ('REFERRAL_SUBMITTED','ACKNOWLEDGED','ACCEPTED','APPROVAL_PENDING') and p_actor='hospital' then 'INFO_REQUESTED'
    when p_action='provide_info' and p_from='INFO_REQUESTED' and p_actor='patient' then 'REFERRAL_SUBMITTED'
    when p_action='accept' and p_from in ('ACKNOWLEDGED','REFERRAL_SUBMITTED') and p_actor='hospital' then 'ACCEPTED'
    when p_action='redirect' and p_from in ('ACKNOWLEDGED','ACCEPTED','REFERRAL_SUBMITTED','REJECTED') and p_actor='hospital' then 'REDIRECTED'
    when p_action='offer_slot' and p_from in ('ACCEPTED','REDIRECTED','APPROVED','WAITLISTED') and p_actor='hospital' then 'SLOT_OFFERED'
    when p_action='join_waitlist' and p_from in ('PATIENT_SELECTED','RECOVERY_REQUIRED') and p_actor in ('patient','system') then 'WAITLISTED'
    when p_action='confirm_booking' and p_from='ACCEPTED' and p_actor='system' then 'BOOKED'
    when p_action='remind' and p_from='BOOKED' and p_actor='system' then 'REMINDER'
    when p_action='request_reschedule' and p_from in ('BOOKED','REMINDER') and p_actor='patient' then 'RESCHEDULE_REQUESTED'
    when p_action='reschedule' and p_from in ('RESCHEDULE_REQUESTED','BOOKED','REMINDER') and p_actor in ('patient','hospital') then 'RESCHEDULED'
    when p_action='request_recovery' and p_from in ('APPROVAL_EXPIRED','REJECTED','BOOKED','REMINDER','RESCHEDULED','NO_SHOW','CANCELLED') and p_actor in ('hospital','system') then 'RECOVERY_REQUIRED'
    when p_action='offer_recovery' and p_from='RECOVERY_REQUIRED' and p_actor in ('hospital','system') then 'RECOVERY_OPTIONS_AVAILABLE'
    when p_action='select_recovery' and p_from='RECOVERY_OPTIONS_AVAILABLE' and p_actor='patient' then 'PATIENT_SELECTED'
    when p_action='rebook' and p_from='PATIENT_SELECTED' and p_actor in ('patient','system') then 'REBOOKED'
    when p_action='arrive' and p_from in ('BOOKED','REMINDER','RESCHEDULED') and p_actor='hospital' then 'ARRIVED'
    when p_action='no_show' and p_from in ('BOOKED','REMINDER','RESCHEDULED') and p_actor='hospital' then 'NO_SHOW'
    when p_action='complete' and p_from='ARRIVED' and p_actor='hospital' then 'SERVICE_COMPLETED'
    when p_action='open_follow_up' and p_from='SERVICE_COMPLETED' and p_actor in ('hospital','system') then 'FOLLOW_UP_OPEN'
    when p_action='close' and p_from in ('SERVICE_COMPLETED','FOLLOW_UP_OPEN') and p_actor in ('patient','hospital','system') then 'CLOSED'
    when p_action='cancel' and p_from in ('REQUESTED','SCREENED','OPTIONS_OFFERED','PATIENT_SELECTED','REFERRAL_SUBMITTED','APPROVAL_PENDING','APPROVAL_EXPIRED','APPROVED','REJECTED','ACKNOWLEDGED','INFO_REQUESTED','ACCEPTED','SLOT_OFFERED','WAITLISTED','BOOKED','REMINDER','RESCHEDULED','RESCHEDULE_REQUESTED','RECOVERY_REQUIRED','RECOVERY_OPTIONS_AVAILABLE','REBOOKED') and p_actor in ('patient','hospital') then 'CANCELLED'
    else null
  end;
  return v_to;
end;
$function$;

create or replace function private.transition_care_request(
  p_id uuid, p_action text, p_option uuid, p_appointment uuid,
  p_reason text, p_metadata jsonb, p_expected_version integer
) returns public.care_requests
language plpgsql security definer set search_path = '' as $function$
declare
  actor uuid := private.actor();
  v public.care_requests;
  v_before text;
  v_to text;
  v_option public.care_access_options;
  v_slot public.slots;
  v_now timestamptz := clock_timestamp();
  v_actor_role text;
  v_episode uuid;
  v_queue_position integer;
  v_system boolean := coalesce(current_setting('flowcare.system_transition', true), '') = 'true';
begin
  select * into v from public.care_requests where id=p_id for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  if v.patient_id <> actor and (v.selected_hospital_id is null or not private.allowed(v.selected_hospital_id, 'appointments:manage')) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if p_expected_version is not null and p_expected_version <> v.version then raise exception using errcode='P0001', message='VERSION_CONFLICT'; end if;
  v_before := v.state;
  v_actor_role := case when v_system then 'system' when v.patient_id=actor then 'patient' else 'hospital' end;
  v_to := private.care_transition_allowed(v.state,p_action,v_actor_role);
  if v_to is null then raise exception using errcode='P0001', message='INVALID_TRANSITION'; end if;
  if p_action in ('request_info','redirect','cancel','reschedule','request_reschedule','no_show','provide_info','expire_approval','request_recovery') and nullif(btrim(p_reason),'') is null then
    raise exception using errcode='P0001', message='REASON_REQUIRED';
  end if;
  if p_action in ('select_option','offer_slot','request_approval','join_waitlist','select_recovery','rebook') then
    if p_option is null then p_option := v.selected_option_id; end if;
    if p_option is null then raise exception using errcode='P0001', message='OPTION_REQUIRED'; end if;
    select * into v_option from public.care_access_options where id=p_option and care_request_id=v.id and eligible for update;
    if not found then raise exception using errcode='P0001', message='OPTION_NOT_FOUND'; end if;
    if p_action in ('select_option','select_recovery','request_approval','join_waitlist','rebook') then
      update public.care_access_options set status=case when id=p_option then 'selected' else 'declined' end,
        selected_at=case when id=p_option then v_now else selected_at end
        where care_request_id=v.id and status='offered';
    end if;
    v.selected_hospital_id := v_option.hospital_id;
    v.selected_option_id := v_option.id;
    v.slot_type := v_option.slot_type;
    select * into v_slot from public.slots where id=v_option.session_id;
    v.approval_response_window_minutes := coalesce(v.approval_response_window_minutes, v_slot.approval_response_window_minutes, 240);
    v.approval_deadline := case when p_action='request_approval' and v_option.slot_type='approval_required' then coalesce(v_option.approval_deadline, v_now+make_interval(mins=>v.approval_response_window_minutes)) else v_option.approval_deadline end;
  elsif p_action in ('submit_referral','confirm_booking','expire_approval') and v.selected_option_id is not null then
    select * into v_option from public.care_access_options where id=v.selected_option_id and care_request_id=v.id;
    if v_option.id is not null then select * into v_slot from public.slots where id=v_option.session_id; end if;
  end if;
  if p_action in ('submit_referral','confirm_booking') and p_appointment is not null then v.appointment_id := p_appointment; end if;
  if p_action in ('request_approval','join_waitlist','rebook') and v.queue_id is null then v.queue_id := private.next_queue_id(v_option.department_id); end if;
  if p_action in ('request_approval','join_waitlist') and v.queue_id is not null then
    select count(*)+1 into v_queue_position from public.queue_entries qe where qe.slot_id=v_option.session_id and qe.status in ('waiting','approval_pending');
  end if;
  v.state := v_to; v.version := v.version+1; v.updated_at := v_now;
  if v_to='CLOSED' then v.closed_at:=v_now; end if;
  if v.episode_id is null and v.selected_hospital_id is not null and v.state in ('PATIENT_SELECTED','REFERRAL_SUBMITTED','APPROVAL_PENDING','APPROVED','ACKNOWLEDGED','ACCEPTED','SLOT_OFFERED','WAITLISTED','BOOKED','RECOVERY_REQUIRED','RECOVERY_OPTIONS_AVAILABLE','REBOOKED') then
    insert into public.care_episodes(care_request_id,patient_id,hospital_id,appointment_id) values(v.id,v.patient_id,v.selected_hospital_id,v.appointment_id) returning id into v_episode;
    v.episode_id:=v_episode;
  elsif v.episode_id is not null then
    update public.care_episodes set appointment_id=coalesce(v.appointment_id,appointment_id), follow_up_required=case when v.state='FOLLOW_UP_OPEN' then true else follow_up_required end, closed_at=case when v.state='CLOSED' then v_now else closed_at end where id=v.episode_id;
  end if;
  update public.care_requests set state=v.state,selected_hospital_id=v.selected_hospital_id,selected_option_id=v.selected_option_id,appointment_id=v.appointment_id,episode_id=v.episode_id,version=v.version,updated_at=v.updated_at,closed_at=v.closed_at,queue_id=v.queue_id,queue_position=v_queue_position,slot_type=v.slot_type,approval_deadline=v.approval_deadline,approval_response_window_minutes=v.approval_response_window_minutes,recovery_policy=coalesce(v.recovery_policy,v.recovery_policy) where id=v.id returning * into v;
  if v.queue_id is not null and v_option.id is not null and p_action in ('request_approval','join_waitlist','rebook','confirm_booking','expire_approval') then
    insert into public.queue_entries(queue_id,care_request_id,appointment_id,patient_id,hospital_id,department_id,provider_id,slot_id,queue_type,status,position,estimated_slot_at,last_updated_at)
    values(v.queue_id,v.id,v.appointment_id,v.patient_id,v.selected_hospital_id,v_option.department_id,v_option.provider_id,v_option.session_id,
      case when v.slot_type='waitlist' then 'waitlist' when p_action='rebook' then 'recovery' else 'approval' end,
      case when v.state='WAITLISTED' then 'waiting' when v.state='APPROVAL_PENDING' then 'approval_pending' when v.state in ('BOOKED','REBOOKED') then 'booked' else 'expired' end,
      v_queue_position,case when v_slot.id is not null then v_slot.starts_at else null end,v_now)
    on conflict (care_request_id) do update set queue_id=excluded.queue_id,appointment_id=excluded.appointment_id,slot_id=excluded.slot_id,status=excluded.status,position=excluded.position,estimated_slot_at=excluded.estimated_slot_at,last_updated_at=v_now;
  end if;
  if p_action='expire_approval' then
    insert into public.recovery_events(care_request_id,appointment_id,reason,previous_state,metadata) values(v.id,v.appointment_id,'hospital_no_response',v_before,coalesce(p_metadata,'{}'::jsonb));
  elsif p_action='request_recovery' then
    insert into public.recovery_events(care_request_id,appointment_id,reason,previous_state,metadata) values(v.id,v.appointment_id,coalesce((p_metadata->>'reason')::text,'slot_expired'),v_before,coalesce(p_metadata,'{}'::jsonb));
  end if;
  insert into public.care_state_transitions(care_request_id,previous_state,new_state,action,actor_id,actor_role,reason,metadata)
    values(v.id,v_before,v.state,p_action,actor,v_actor_role,nullif(btrim(p_reason),''),coalesce(p_metadata,'{}'::jsonb));
  return v;
end;
$function$;

create or replace function public.transition_care_request_system(
  p_id uuid, p_actor uuid, p_action text, p_option uuid default null, p_appointment uuid default null,
  p_reason text default null, p_metadata jsonb default '{}'::jsonb, p_expected_version integer default null
) returns public.care_requests language plpgsql security definer set search_path = '' as $function$
declare v public.care_requests;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_action not in ('screen','offer_options','remind','open_follow_up','expire_approval','request_recovery','offer_recovery','request_approval','join_waitlist','confirm_booking','rebook') then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('flowcare.system_transition','true',true);
  select * into v from private.transition_care_request(p_id,p_action,p_option,p_appointment,p_reason,p_metadata,p_expected_version);
  return v;
end;
$function$;

-- A published instant slot is not a confirmation. The patient request is
-- always stored as requested, and the queue remains pending until the
-- hospital uses the normal appointment accept transition.
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
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  select * into d from public.departments where id = s.department_id for update;
  if not d.booking_open or not s.booking_open or not private.hospital_public(d.hospital_id)
     or s.ends_at <= clock_timestamp() or (s.kind = 'appointment' and s.starts_at <= clock_timestamp()) then
    raise exception using errcode = 'P0001', message = 'BOOKING_CLOSED';
  end if;
  if s.slot_type = 'waitlist' then raise exception using errcode = 'P0001', message = 'WAITLIST_REQUIRED'; end if;
  if (select count(*) from public.appointments where slot_id = s.id and status not in ('cancelled','denied','no_show')) >= s.capacity then
    raise exception using errcode = 'P0001', message = 'CAPACITY_FULL';
  end if;

  insert into private.idempotency(actor_id, key, request)
    values (actor, p_key, payload)
    on conflict do nothing;
  select * into previous from private.idempotency where actor_id = actor and key = p_key for update;
  if previous.request <> payload then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
  if previous.response is not null then return previous.response; end if;

  st := s.slot_type;
  deadline := case when st = 'approval_required' then clock_timestamp() + make_interval(mins => s.approval_response_window_minutes) else null end;
  q := private.next_queue_id(s.department_id);

  insert into public.appointments(
    hospital_id, department_id, slot_id, patient_id, patient_name, request_note,
    status, queue_id, slot_type, approval_status, approval_deadline, patient_phone
  ) values (
    d.hospital_id, d.id, s.id, actor, trim(p_name), nullif(btrim(p_request_note), ''),
    'requested', q, st, case when st = 'approval_required' then 'pending' else 'not_required' end,
    deadline, (select nullif(phone, '') from auth.users where id = actor)
  ) returning * into a;

  insert into public.queue_entries(
    queue_id, appointment_id, patient_id, hospital_id, department_id,
    provider_id, slot_id, queue_type, status, position, estimated_slot_at
  ) values (
    q, a.id, actor, d.hospital_id, d.id, s.provider_id, s.id, 'appointment',
    'approval_pending', null, s.starts_at
  );

  insert into public.appointment_events(appointment_id, actor_id, action, version, details)
    values (a.id, actor, 'book', a.version,
      jsonb_build_object('slotId', a.slot_id, 'status', a.status, 'queueId', q, 'slotType', st));

  result := to_jsonb(a);
  update private.idempotency set response = result where actor_id = actor and key = p_key;
  return result;
end;
$function$;

create or replace function private.book_appointment_v2(p_slot uuid, p_name text, p_key text)
returns jsonb language sql security definer set search_path = '' as $function$
  select private.book_appointment_v2(p_slot, p_name, p_key, null)
$function$;

create or replace function public.book_appointment(p_slot uuid, p_name text, p_key text)
returns jsonb language sql security definer set search_path = '' as $function$
  select private.book_appointment_v2(p_slot, p_name, p_key)
$function$;

grant execute on function public.book_appointment(uuid, text, text) to authenticated;
grant execute on function public.book_appointment(uuid, text, text, text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0023_care_access_booking_truth')
  on conflict (version) do nothing;

commit;
