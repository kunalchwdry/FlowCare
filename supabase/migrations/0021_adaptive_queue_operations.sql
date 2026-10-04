/*
  FlowCare additive MVP: adaptive slots, supply-side configuration, queue IDs,
  approval deadlines, waitlists, recovery, and auditable operational access.

  This migration deliberately extends the existing departments, slots,
  appointments, Care Access, memberships, and audit tables. It does not create
  parallel hospital, appointment, or care-request systems.
*/

begin;

-- Existing membership rows remain valid; these permissions are opt-in.
alter table public.memberships drop constraint if exists memberships_permissions_check;
alter table public.memberships add constraint memberships_permissions_check check (
  permissions <@ array[
    'appointments:read','appointments:manage','queue:read','queue:manage',
    'memberships:manage','reviews:moderate','facts:manage','corrections:review',
    'structure:manage','slots:manage','exports:read'
  ]::text[]
);

alter table public.departments
  add column if not exists approval_response_window_minutes integer not null default 240,
  add column if not exists waitlist_enabled boolean not null default true,
  add column if not exists recovery_policy text not null default 'offer_alternatives',
  add column if not exists queue_order_rule text not null default 'arrival_order';
alter table public.departments drop constraint if exists departments_approval_window_check;
alter table public.departments add constraint departments_approval_window_check check (approval_response_window_minutes between 5 and 10080);
alter table public.departments drop constraint if exists departments_recovery_policy_check;
alter table public.departments add constraint departments_recovery_policy_check check (recovery_policy in ('offer_alternatives','continue_waiting','manual_review','stay_with_hospital'));
alter table public.departments drop constraint if exists departments_queue_order_rule_check;
alter table public.departments add constraint departments_queue_order_rule_check check (queue_order_rule in ('arrival_order','scheduled_time','manual'));

create table if not exists public.department_services (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  service_slug text not null check (length(btrim(service_slug)) between 1 and 120),
  label text not null check (length(btrim(label)) between 1 and 160),
  active boolean not null default true,
  source text not null default 'hospital_configured' check (source in ('hospital_configured','hospital_published','flowcare_verified')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (department_id, service_slug)
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160),
  specialty text,
  qualification text,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (hospital_id, id)
);
create index if not exists providers_department_active_idx on public.providers(department_id, active);

create table if not exists public.provider_schedules (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  timezone text not null default 'Asia/Kolkata',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (ends_at > starts_at)
);
create index if not exists provider_schedules_lookup_idx on public.provider_schedules(provider_id, weekday, active);

alter table public.slots
  add column if not exists provider_id uuid references public.providers(id) on delete set null,
  add column if not exists service_slug text,
  add column if not exists slot_type text not null default 'approval_required',
  add column if not exists waitlist_enabled boolean not null default false,
  add column if not exists approval_response_window_minutes integer not null default 240,
  add column if not exists recovery_policy text not null default 'offer_alternatives',
  add column if not exists expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.slots drop constraint if exists slots_slot_type_check;
alter table public.slots add constraint slots_slot_type_check check (slot_type in ('instant','approval_required','waitlist'));
alter table public.slots drop constraint if exists slots_approval_window_check;
alter table public.slots add constraint slots_approval_window_check check (approval_response_window_minutes between 5 and 10080);
alter table public.slots drop constraint if exists slots_recovery_policy_check;
alter table public.slots add constraint slots_recovery_policy_check check (recovery_policy in ('offer_alternatives','continue_waiting','manual_review','stay_with_hospital'));
create index if not exists slots_operational_lookup_idx on public.slots(department_id, slot_type, booking_open, starts_at);

alter table public.appointments
  add column if not exists queue_id text,
  add column if not exists slot_type text not null default 'approval_required',
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists approval_deadline timestamptz,
  add column if not exists patient_phone text;
alter table public.appointments drop constraint if exists appointments_slot_type_check;
alter table public.appointments add constraint appointments_slot_type_check check (slot_type in ('instant','approval_required','waitlist'));
alter table public.appointments drop constraint if exists appointments_approval_status_check;
alter table public.appointments add constraint appointments_approval_status_check check (approval_status in ('not_required','pending','approved','expired','rejected'));
create unique index if not exists appointments_queue_id_uidx on public.appointments(queue_id) where queue_id is not null;

alter table public.care_requests
  add column if not exists patient_phone text,
  add column if not exists queue_id text,
  add column if not exists slot_type text,
  add column if not exists approval_deadline timestamptz,
  add column if not exists approval_response_window_minutes integer,
  add column if not exists recovery_policy text,
  add column if not exists queue_position integer;
alter table public.care_requests drop constraint if exists care_requests_state_check;
alter table public.care_requests add constraint care_requests_state_check check (state = any (array[
  'REQUESTED','SCREENED','OPTIONS_OFFERED','PATIENT_SELECTED','REFERRAL_SUBMITTED',
  'APPROVAL_PENDING','APPROVAL_EXPIRED','APPROVED','REJECTED','ACKNOWLEDGED',
  'INFO_REQUESTED','ACCEPTED','REDIRECTED','SLOT_OFFERED','WAITLISTED','BOOKED',
  'REMINDER','RESCHEDULED','RESCHEDULE_REQUESTED','CANCELLED','RECOVERY_REQUIRED',
  'RECOVERY_OPTIONS_AVAILABLE','REBOOKED','ARRIVED','NO_SHOW','SERVICE_COMPLETED',
  'FOLLOW_UP_OPEN','CLOSED'
]));
alter table public.care_requests drop constraint if exists care_requests_slot_type_check;
alter table public.care_requests add constraint care_requests_slot_type_check check (slot_type is null or slot_type in ('instant','approval_required','waitlist'));
create unique index if not exists care_requests_queue_id_uidx on public.care_requests(queue_id) where queue_id is not null;

alter table public.care_access_options
  add column if not exists provider_id uuid references public.providers(id) on delete set null,
  add column if not exists service_slug text,
  add column if not exists slot_type text not null default 'approval_required',
  add column if not exists approval_required boolean not null default true,
  add column if not exists waitlist_enabled boolean not null default false,
  add column if not exists approval_deadline timestamptz;
alter table public.care_access_options drop constraint if exists care_access_options_slot_type_check;
alter table public.care_access_options add constraint care_access_options_slot_type_check check (slot_type in ('instant','approval_required','waitlist'));

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  queue_id text not null unique,
  care_request_id uuid unique references public.care_requests(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id uuid not null references auth.users(id) on delete restrict,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  provider_id uuid references public.providers(id) on delete set null,
  slot_id uuid references public.slots(id) on delete set null,
  queue_type text not null check (queue_type in ('approval','waitlist','appointment','recovery')),
  status text not null check (status in ('waiting','approval_pending','approved','booked','expired','cancelled','rebooked','completed')),
  position integer,
  estimated_slot_at timestamptz,
  last_updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists queue_entries_hospital_status_idx on public.queue_entries(hospital_id, status, last_updated_at desc);
create index if not exists queue_entries_patient_idx on public.queue_entries(patient_id, last_updated_at desc);

create table if not exists public.recovery_events (
  id uuid primary key default gen_random_uuid(),
  care_request_id uuid not null references public.care_requests(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  reason text not null check (reason in ('hospital_no_response','slot_expired','appointment_cancelled','capacity_changed','provider_unavailable','appointment_rejected','patient_reschedule')),
  previous_state text not null,
  detected_at timestamptz not null default clock_timestamp(),
  selected_option_id uuid references public.care_access_options(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists recovery_events_request_idx on public.recovery_events(care_request_id, detected_at desc);

create or replace function private.create_care_request(p_specialty text,p_service_type text,p_location text,p_start date,p_end date,p_time_range text,p_budget text,p_accessibility text[],p_languages text[],p_coverage text,p_referral_required boolean)
returns public.care_requests language plpgsql security definer set search_path = '' as $function$
declare actor uuid:=private.actor(); v public.care_requests;
begin
  if p_service_type is null or length(btrim(p_service_type)) not between 1 and 120 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.care_requests(patient_id,patient_phone,specialty,service_type,location,preferred_start_date,preferred_end_date,preferred_time_range,budget_constraint,accessibility_requirements,language_preference,coverage,referral_required)
  values(actor,(select nullif(phone,'') from auth.users where id=actor),nullif(btrim(p_specialty),''),btrim(p_service_type),nullif(btrim(p_location),''),p_start,p_end,nullif(btrim(p_time_range),''),nullif(btrim(p_budget),''),coalesce(p_accessibility,'{}'),coalesce(p_languages,'{}'),nullif(btrim(p_coverage),''),p_referral_required)
  returning * into v;
  insert into public.care_state_transitions(care_request_id,previous_state,new_state,action,actor_id,actor_role,metadata) values(v.id,null,'REQUESTED','create',actor,'patient','{}'::jsonb);
  return v;
end;
$function$;

-- Queue IDs are human-readable but non-semantic. They are not a clinical rank.
create or replace function private.next_queue_id(p_department uuid)
returns text language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_prefix text;
  v_candidate text;
begin
  select upper(left(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'), 8)) into v_prefix
    from public.departments where id = p_department;
  v_prefix := coalesce(nullif(v_prefix,''),'CARE');
  loop
    v_candidate := 'FC-' || to_char(clock_timestamp(), 'YYYY') || '-' || v_prefix || '-' || lpad((floor(random()*1000000))::integer::text, 6, '0');
    exit when not exists (select 1 from public.queue_entries where queue_id=v_candidate)
      and not exists (select 1 from public.care_requests where queue_id=v_candidate)
      and not exists (select 1 from public.appointments where queue_id=v_candidate);
  end loop;
  return v_candidate;
end;
$function$;

create or replace function private.care_transition_allowed(p_from text, p_action text, p_actor text)
returns text language plpgsql immutable set search_path = '' as $function$
declare v_to text;
begin
  v_to := case
    when p_action='screen' and p_from='REQUESTED' and p_actor='system' then 'SCREENED'
    when p_action='offer_options' and p_from='SCREENED' and p_actor='system' then 'OPTIONS_OFFERED'
    when p_action='select_option' and p_from in ('OPTIONS_OFFERED','RECOVERY_OPTIONS_AVAILABLE') and p_actor='patient' then 'PATIENT_SELECTED'
    when p_action='submit_referral' and p_from='PATIENT_SELECTED' and p_actor in ('patient','system') then 'REFERRAL_SUBMITTED'
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
    when p_action='book' and p_from in ('PATIENT_SELECTED','SLOT_OFFERED','RESCHEDULED','REBOOKED') and p_actor in ('patient','system') then 'BOOKED'
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

-- Save options using the slot's database configuration as the source of truth.
create or replace function private.save_care_access_options(p_request uuid, p_options jsonb)
returns setof public.care_access_options language plpgsql security definer set search_path = '' as $function$
declare actor uuid:=private.actor(); item jsonb; v_slot public.slots;
begin
  if not exists(select 1 from public.care_requests where id=p_request and patient_id=actor) then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  delete from public.care_access_options where care_request_id=p_request;
  for item in select * from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) loop
    if not exists(select 1 from public.hospitals h where h.id=(item->>'hospital_id')::uuid) then raise exception using errcode='P0001',message='INVALID_OPTION'; end if;
    if nullif(item->>'department_id','') is not null and not exists(select 1 from public.departments d where d.id=(item->>'department_id')::uuid and d.hospital_id=(item->>'hospital_id')::uuid) then raise exception using errcode='P0001',message='INVALID_OPTION'; end if;
    if nullif(item->>'session_id','') is not null then
      select s.* into v_slot from public.slots s join public.departments d on d.id=s.department_id where s.id=(item->>'session_id')::uuid and d.hospital_id=(item->>'hospital_id')::uuid and (nullif(item->>'department_id','') is null or s.department_id=(item->>'department_id')::uuid);
      if not found then raise exception using errcode='P0001',message='INVALID_OPTION'; end if;
    else v_slot:=null; end if;
    if coalesce((item->>'eligible')::boolean,false) and (v_slot.id is null or not coalesce((item->>'capability_matched')::boolean,false)) then raise exception using errcode='P0001',message='INVALID_OPTION'; end if;
    insert into public.care_access_options(care_request_id,hospital_id,department_id,session_id,provider_id,service_slug,slot_type,approval_required,waitlist_enabled,distance_km,queue_wait_minutes,queue_observed_at,cost_band,cost_verified_at,accessibility,languages,capability_matched,eligible,freshness,freshness_label,reasons,status,offered_at,expires_at,approval_deadline)
    values(p_request,(item->>'hospital_id')::uuid,nullif(item->>'department_id','')::uuid,nullif(item->>'session_id','')::uuid,coalesce(v_slot.provider_id,nullif(item->>'provider_id','')::uuid),coalesce(v_slot.service_slug,nullif(item->>'service_slug','')),coalesce(v_slot.slot_type,nullif(item->>'slot_type',''),'approval_required'),coalesce((item->>'approval_required')::boolean,coalesce(v_slot.slot_type,'approval_required')='approval_required'),coalesce((item->>'waitlist_enabled')::boolean,coalesce(v_slot.waitlist_enabled,false)),nullif(item->>'distance_km','')::numeric,nullif(item->>'queue_wait_minutes','')::integer,nullif(item->>'queue_observed_at','')::timestamptz,nullif(item->>'cost_band',''),nullif(item->>'cost_verified_at','')::timestamptz,coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(item->'accessibility','[]'::jsonb)) x),'{}'),coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(item->'languages','[]'::jsonb)) x),'{}'),coalesce((item->>'capability_matched')::boolean,false),coalesce((item->>'eligible')::boolean,false),coalesce(item->>'freshness','unavailable'),coalesce(item->>'freshness_label','Capacity update unavailable'),coalesce(item->'reasons','[]'::jsonb),coalesce(item->>'status','offered'),coalesce((item->>'offered_at')::timestamptz,clock_timestamp()),nullif(item->>'expires_at','')::timestamptz,nullif(item->>'approval_deadline','')::timestamptz);
  end loop;
  return query select * from public.care_access_options where care_request_id=p_request order by eligible desc,offered_at desc;
end;
$function$;

-- Replace the existing private transition implementation with the same guarded
-- path plus queue/recovery bookkeeping. Direct table writes remain unavailable.
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
  v_queue_id text;
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
  elsif p_action in ('book','expire_approval') and v.selected_option_id is not null then
    select * into v_option from public.care_access_options where id=v.selected_option_id and care_request_id=v.id;
    if v_option.id is not null then select * into v_slot from public.slots where id=v_option.session_id; end if;
  end if;
  if p_action='book' and p_appointment is not null then v.appointment_id := p_appointment; end if;
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
  if v.queue_id is not null and v_option.id is not null and p_action in ('request_approval','join_waitlist','rebook','book','expire_approval') then
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
  if p_action not in ('screen','offer_options','remind','open_follow_up','expire_approval','request_recovery','offer_recovery','request_approval','join_waitlist','book','rebook') then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('flowcare.system_transition','true',true);
  select * into v from private.transition_care_request(p_id,p_action,p_option,p_appointment,p_reason,p_metadata,p_expected_version);
  return v;
end;
$function$;

-- Direct appointment bookings use one guarded path so slot type and queue ID
-- cannot be bypassed by a client write.
create or replace function private.book_appointment_v2(p_slot uuid,p_name text,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor uuid := private.actor(); s public.slots; d public.departments; a public.appointments;
  q text; st text; deadline timestamptz; result jsonb; previous private.idempotency; payload jsonb:=jsonb_build_array('book',p_slot,p_name);
begin
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[a-zA-Z0-9_-]+$' then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  select * into s from public.slots where id=p_slot for update;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  select * into d from public.departments where id=s.department_id for update;
  if not d.booking_open or not s.booking_open or not private.hospital_public(d.hospital_id) or s.ends_at<=clock_timestamp() or (s.kind='appointment' and s.starts_at<=clock_timestamp()) then raise exception using errcode='P0001',message='BOOKING_CLOSED'; end if;
  if s.slot_type='waitlist' then raise exception using errcode='P0001',message='WAITLIST_REQUIRED'; end if;
  if (select count(*) from public.appointments where slot_id=s.id and status not in ('cancelled','denied','no_show'))>=s.capacity then raise exception using errcode='P0001',message='CAPACITY_FULL'; end if;
  insert into private.idempotency(actor_id,key,request) values(actor,p_key,payload) on conflict do nothing;
  select * into previous from private.idempotency where actor_id=actor and key=p_key for update;
  if previous.request<>payload then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  if previous.response is not null then return previous.response; end if;
  st:=s.slot_type; deadline:=case when st='approval_required' then clock_timestamp()+make_interval(mins=>s.approval_response_window_minutes) else null end; q:=private.next_queue_id(s.department_id);
  insert into public.appointments(hospital_id,department_id,slot_id,patient_id,patient_name,status,queue_id,slot_type,approval_status,approval_deadline,patient_phone)
    values(d.hospital_id,d.id,s.id,actor,trim(p_name),case when st='instant' then 'confirmed' else 'requested' end,q,st,case when st='instant' then 'not_required' else 'pending' end,deadline,(select nullif(phone,'') from auth.users where id=actor)) returning * into a;
  insert into public.queue_entries(queue_id,appointment_id,patient_id,hospital_id,department_id,provider_id,slot_id,queue_type,status,position,estimated_slot_at)
    values(q,a.id,actor,d.hospital_id,d.id,s.provider_id,s.id,'appointment',case when st='instant' then 'booked' else 'approval_pending' end,null,s.starts_at);
  insert into public.appointment_events(appointment_id,actor_id,action,version,details) values(a.id,actor,'book',a.version,jsonb_build_object('slotId',a.slot_id,'status',a.status,'queueId',q,'slotType',st));
  result:=to_jsonb(a); update private.idempotency set response=result where actor_id=actor and key=p_key; return result;
end;
$function$;

create or replace function public.book_appointment(p_slot uuid,p_name text,p_key text)
returns jsonb language sql security definer set search_path = '' as $function$ select private.book_appointment_v2(p_slot,p_name,p_key) $function$;

create or replace function public.join_waitlist(p_slot uuid,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor uuid:=private.actor(); s public.slots; d public.departments; q text; result jsonb; previous private.idempotency; existing public.queue_entries; payload jsonb:=jsonb_build_array('waitlist',p_slot);
begin
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[a-zA-Z0-9_-]+$' then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  select * into s from public.slots where id=p_slot for update; if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  select * into d from public.departments where id=s.department_id; if not s.booking_open or not d.booking_open or s.slot_type<>'waitlist' or not s.waitlist_enabled then raise exception using errcode='P0001',message='WAITLIST_CLOSED'; end if;
  insert into private.idempotency(actor_id,key,request) values(actor,p_key,payload) on conflict do nothing;
  select * into previous from private.idempotency where actor_id=actor and key=p_key for update;
  if previous.request<>payload then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if; if previous.response is not null then return previous.response; end if;
  select * into existing from public.queue_entries where patient_id=actor and slot_id=s.id and status in ('waiting','approval_pending') limit 1;
  if existing.id is not null then result:=jsonb_build_object('queueId',existing.queue_id,'slotId',s.id,'status',existing.status); update private.idempotency set response=result where actor_id=actor and key=p_key; return result; end if;
  q:=private.next_queue_id(s.department_id);
  insert into public.queue_entries(queue_id,patient_id,hospital_id,department_id,provider_id,slot_id,queue_type,status,position,estimated_slot_at)
    values(q,actor,d.hospital_id,d.id,s.provider_id,s.id,'waitlist','waiting',(select count(*)+1 from public.queue_entries where slot_id=s.id and status='waiting'),s.starts_at);
  result:=jsonb_build_object('queueId',q,'slotId',s.id,'status','waiting'); update private.idempotency set response=result where actor_id=actor and key=p_key; return result;
end;
$function$;

create or replace function public.expire_due_approvals()
returns integer language plpgsql security definer set search_path = '' as $function$
declare r record; changed integer:=0; ignored public.care_requests;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  for r in select id,patient_id,version from public.care_requests where state='APPROVAL_PENDING' and approval_deadline is not null and approval_deadline<=clock_timestamp() for update loop
    begin
      perform set_config('request.jwt.claim.sub',r.patient_id::text,true); perform set_config('flowcare.system_transition','true',true);
      select * into ignored from private.transition_care_request(r.id,'expire_approval',null,null,'Approval deadline passed without a hospital decision','{"reason":"hospital_no_response"}'::jsonb,r.version);
      changed:=changed+1;
    exception when others then null;
    end;
  end loop;
  return changed;
end;
$function$;

create or replace function public.record_audit_event(p_actor_role text,p_action text,p_entity text,p_entity_id text,p_metadata jsonb default '{}'::jsonb)
returns public.audit_events language plpgsql security definer set search_path = '' as $function$
declare v public.audit_events; actor uuid:=private.actor();
begin
  if p_action is null or length(p_action) not between 1 and 100 or p_entity is null or length(p_entity) not between 1 and 100 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.audit_events(actor_id,actor_role,action,entity,entity_id,metadata) values(actor,coalesce(nullif(p_actor_role,''),'authenticated'),p_action,p_entity,p_entity_id,coalesce(p_metadata,'{}'::jsonb)) returning * into v;
  return v;
end;
$function$;
grant execute on function public.record_audit_event(text,text,text,text,jsonb) to authenticated;

-- Hospital-scoped supply-side mutations. These are small SECURITY DEFINER
-- functions so the client never writes appointments or operational rows directly.
drop function if exists public.create_operational_department(uuid,text,boolean,integer,integer,integer,boolean,text);
create or replace function public.create_operational_department(
  p_hospital uuid, p_name text, p_booking_open boolean default true,
  p_consultation_capacity integer default 4, p_no_show_grace_minutes integer default 30,
  p_approval_response_window_minutes integer default 240, p_waitlist_enabled boolean default true,
  p_recovery_policy text default 'offer_alternatives', p_queue_order_rule text default 'arrival_order'
) returns public.departments language plpgsql security definer set search_path = '' as $function$
declare v public.departments;
begin
  if not (private.allowed(p_hospital,'structure:manage') or private.allowed(p_hospital,'memberships:manage')) then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 160 or p_consultation_capacity<1 or p_queue_order_rule not in ('arrival_order','scheduled_time','manual') then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.departments(hospital_id,name,booking_open,consultation_capacity,no_show_grace_minutes,approval_response_window_minutes,waitlist_enabled,recovery_policy,queue_order_rule)
    values(p_hospital,btrim(p_name),p_booking_open,p_consultation_capacity,p_no_show_grace_minutes,p_approval_response_window_minutes,p_waitlist_enabled,p_recovery_policy,p_queue_order_rule)
    returning * into v;
  return v;
end;
$function$;

grant execute on function public.create_operational_department(uuid,text,boolean,integer,integer,integer,boolean,text,text) to authenticated;

create or replace function public.create_department_service(p_department uuid,p_service_slug text,p_label text,p_active boolean default true)
returns public.department_services language plpgsql security definer set search_path = '' as $function$
declare v public.department_services; h uuid;
begin
  select hospital_id into h from public.departments where id=p_department;
  if h is null then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if not (private.allowed(h,'structure:manage') or private.allowed(h,'slots:manage')) then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_service_slug is null or length(btrim(p_service_slug)) not between 1 and 120 or p_label is null or length(btrim(p_label)) not between 1 and 160 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.department_services(department_id,service_slug,label,active) values(p_department,lower(regexp_replace(btrim(p_service_slug),'[^a-zA-Z0-9]+','-','g')),btrim(p_label),p_active) returning * into v;
  return v;
end;
$function$;
grant execute on function public.create_department_service(uuid,text,text,boolean) to authenticated;

create or replace function public.create_provider(
  p_hospital uuid, p_department uuid, p_name text, p_specialty text default null, p_qualification text default null, p_active boolean default true
) returns public.providers language plpgsql security definer set search_path = '' as $function$
declare v public.providers; dept_hospital uuid;
begin
  select hospital_id into dept_hospital from public.departments where id=p_department;
  if dept_hospital is null or dept_hospital<>p_hospital then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if not (private.allowed(p_hospital,'structure:manage') or private.allowed(p_hospital,'memberships:manage')) then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 160 then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.providers(hospital_id,department_id,name,specialty,qualification,active) values(p_hospital,p_department,btrim(p_name),nullif(btrim(p_specialty),''),nullif(btrim(p_qualification),''),p_active) returning * into v;
  return v;
end;
$function$;

grant execute on function public.create_provider(uuid,uuid,text,text,text,boolean) to authenticated;

create or replace function public.create_provider_schedule(p_provider uuid,p_weekday smallint,p_starts time,p_ends time,p_timezone text default 'Asia/Kolkata',p_active boolean default true)
returns public.provider_schedules language plpgsql security definer set search_path = '' as $function$
declare v public.provider_schedules; h uuid;
begin
  select hospital_id into h from public.providers where id=p_provider;
  if h is null then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if not (private.allowed(h,'structure:manage') or private.allowed(h,'slots:manage')) then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_weekday not between 0 and 6 or p_ends<=p_starts then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.provider_schedules(provider_id,weekday,starts_at,ends_at,timezone,active) values(p_provider,p_weekday,p_starts,p_ends,coalesce(nullif(p_timezone,''),'Asia/Kolkata'),p_active) returning * into v;
  return v;
end;
$function$;
grant execute on function public.create_provider_schedule(uuid,smallint,time,time,text,boolean) to authenticated;

create or replace function public.create_operational_slot(
  p_department uuid, p_starts timestamptz, p_ends timestamptz, p_capacity integer,
  p_slot_type text, p_provider uuid default null, p_service_slug text default null,
  p_kind text default 'appointment', p_booking_open boolean default true,
  p_waitlist_enabled boolean default false, p_approval_response_window_minutes integer default 240,
  p_recovery_policy text default 'offer_alternatives', p_expires_at timestamptz default null
) returns public.slots language plpgsql security definer set search_path = '' as $function$
declare v public.slots; h uuid;
begin
  select hospital_id into h from public.departments where id=p_department;
  if h is null then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if not (private.allowed(h,'structure:manage') or private.allowed(h,'slots:manage') or private.allowed(h,'appointments:manage')) then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_ends<=p_starts or p_capacity<1 or p_slot_type not in ('instant','approval_required','waitlist') then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  if p_provider is not null and not exists(select 1 from public.providers where id=p_provider and department_id=p_department and hospital_id=h and active) then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  insert into public.slots(department_id,starts_at,ends_at,kind,capacity,booking_open,provider_id,service_slug,slot_type,waitlist_enabled,approval_response_window_minutes,recovery_policy,expires_at)
    values(p_department,p_starts,p_ends,p_kind,p_capacity,p_booking_open,p_provider,nullif(btrim(p_service_slug),''),p_slot_type,p_waitlist_enabled,p_approval_response_window_minutes,p_recovery_policy,p_expires_at) returning * into v;
  return v;
end;
$function$;

grant execute on function public.create_operational_slot(uuid,timestamptz,timestamptz,integer,text,uuid,text,text,boolean,boolean,integer,text,timestamptz) to authenticated;

create or replace function public.list_public_slot_availability(p_hospital uuid default null, p_limit integer default 400)
returns table(id uuid, department_id uuid, hospital_id uuid, department_name text, starts_at timestamptz, ends_at timestamptz, kind text, capacity integer, booked bigint, booking_open boolean, provider_id uuid, service_slug text, slot_type text, waitlist_enabled boolean, approval_response_window_minutes integer, recovery_policy text, expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $function$
  select s.id,s.department_id,d.hospital_id,d.name,s.starts_at,s.ends_at,s.kind,s.capacity,
    (select count(*) from public.appointments a where a.slot_id=s.id and a.status not in ('cancelled','denied','no_show')) as booked,
    (s.booking_open and d.booking_open and s.ends_at>clock_timestamp() and (s.kind<>'appointment' or s.starts_at>clock_timestamp())) as booking_open,
    s.provider_id,s.service_slug,s.slot_type,s.waitlist_enabled,s.approval_response_window_minutes,s.recovery_policy,s.expires_at,s.updated_at
  from public.slots s join public.departments d on d.id=s.department_id join public.hospitals h on h.id=d.hospital_id
  where h.published and (p_hospital is null or d.hospital_id=p_hospital) and s.starts_at>clock_timestamp()
  order by s.starts_at asc limit greatest(1,least(p_limit,1000));
$function$;
grant execute on function public.list_public_slot_availability(uuid,integer) to anon,authenticated;

create or replace function public.update_operational_slot(
  p_id uuid, p_booking_open boolean default null, p_capacity integer default null,
  p_slot_type text default null, p_waitlist_enabled boolean default null,
  p_approval_response_window_minutes integer default null, p_recovery_policy text default null,
  p_expires_at timestamptz default null
) returns public.slots language plpgsql security definer set search_path = '' as $function$
declare v public.slots; h uuid;
begin
  select d.hospital_id into h from public.slots s join public.departments d on d.id=s.department_id where s.id=p_id;
  if h is null then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if not (private.allowed(h,'structure:manage') or private.allowed(h,'slots:manage') or private.allowed(h,'appointments:manage')) then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  update public.slots set booking_open=coalesce(p_booking_open,booking_open),capacity=coalesce(p_capacity,capacity),slot_type=coalesce(p_slot_type,slot_type),waitlist_enabled=coalesce(p_waitlist_enabled,waitlist_enabled),approval_response_window_minutes=coalesce(p_approval_response_window_minutes,approval_response_window_minutes),recovery_policy=coalesce(p_recovery_policy,recovery_policy),expires_at=p_expires_at,updated_at=clock_timestamp() where id=p_id returning * into v;
  return v;
end;
$function$;

grant execute on function public.update_operational_slot(uuid,boolean,integer,text,boolean,integer,text,timestamptz) to authenticated;

-- Read access is hospital-scoped; management mutations go through the guarded RPCs.
alter table public.department_services enable row level security;
alter table public.providers enable row level security;
alter table public.provider_schedules enable row level security;
alter table public.queue_entries enable row level security;
alter table public.recovery_events enable row level security;

drop policy if exists department_services_public on public.department_services;
create policy department_services_public on public.department_services for select to anon,authenticated using (exists(select 1 from public.departments d join public.hospitals h on h.id=d.hospital_id where d.id=department_id and h.published));
drop policy if exists providers_public on public.providers;
create policy providers_public on public.providers for select to anon,authenticated using (exists(select 1 from public.hospitals h where h.id=hospital_id and h.published));
drop policy if exists provider_schedules_public on public.provider_schedules;
create policy provider_schedules_public on public.provider_schedules for select to anon,authenticated using (exists(select 1 from public.providers p join public.hospitals h on h.id=p.hospital_id where p.id=provider_id and h.published));
drop policy if exists queue_entries_read on public.queue_entries;
create policy queue_entries_read on public.queue_entries for select to authenticated using (patient_id=private.actor() or private.allowed(hospital_id,'queue:read'));
drop policy if exists recovery_events_read on public.recovery_events;
create policy recovery_events_read on public.recovery_events for select to authenticated using (exists(select 1 from public.care_requests r where r.id=care_request_id and (r.patient_id=private.actor() or (r.selected_hospital_id is not null and private.allowed(r.selected_hospital_id,'appointments:read')))));

grant select on public.department_services, public.providers, public.provider_schedules to anon,authenticated;
grant select on public.queue_entries, public.recovery_events to authenticated;
revoke all on public.queue_entries from anon;
grant execute on function public.join_waitlist(uuid,text) to authenticated;
grant execute on function public.book_appointment(uuid,text,text) to authenticated;
grant execute on function public.expire_due_approvals() to service_role;

commit;
