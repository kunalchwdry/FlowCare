-- ===========================================================================
-- 0017_care_access_exchange.sql — closed-loop, capacity-aware care access
-- ===========================================================================
-- Additive only. Reuses the existing hospitals, departments, slots,
-- appointments, facility facts, queue and membership permissions. It does not
-- create parallel appointment/slot/capability tables and it does not create a
-- document vault. A care request is the cross-provider coordination object;
-- an appointment remains the booking system of record.
-- ===========================================================================

create table if not exists public.care_requests (
  id                         uuid primary key default gen_random_uuid(),
  patient_id                 uuid not null references auth.users(id) on delete restrict,
  specialty                 text,
  service_type               text not null check (length(btrim(service_type)) between 1 and 120),
  location                  text,
  preferred_start_date      date,
  preferred_end_date        date,
  preferred_time_range      text,
  budget_constraint         text,
  accessibility_requirements text[] not null default '{}',
  language_preference       text[] not null default '{}',
  coverage                  text,
  referral_required         boolean,
  state                     text not null default 'REQUESTED' check (state in (
    'REQUESTED','SCREENED','OPTIONS_OFFERED','PATIENT_SELECTED',
    'REFERRAL_SUBMITTED','ACKNOWLEDGED','INFO_REQUESTED','ACCEPTED',
    'REDIRECTED','SLOT_OFFERED','BOOKED','REMINDER','RESCHEDULED',
    'CANCELLED','ARRIVED','NO_SHOW','SERVICE_COMPLETED','FOLLOW_UP_OPEN','CLOSED'
  )),
  selected_hospital_id      uuid references public.hospitals(id) on delete restrict,
  selected_option_id        uuid,
  appointment_id            uuid references public.appointments(id) on delete set null,
  episode_id                uuid,
  version                   integer not null default 1 check (version > 0),
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp(),
  closed_at                 timestamptz,
  constraint care_request_dates_ck check (
    preferred_start_date is null or preferred_end_date is null or preferred_start_date <= preferred_end_date
  )
);
create index if not exists care_requests_patient_idx on public.care_requests (patient_id, updated_at desc);
create index if not exists care_requests_hospital_state_idx on public.care_requests (selected_hospital_id, state, updated_at desc);

create table if not exists public.care_episodes (
  id                  uuid primary key default gen_random_uuid(),
  care_request_id     uuid not null unique references public.care_requests(id) on delete cascade,
  patient_id          uuid not null references auth.users(id) on delete restrict,
  hospital_id         uuid references public.hospitals(id) on delete restrict,
  appointment_id      uuid references public.appointments(id) on delete set null,
  follow_up_required  boolean not null default false,
  follow_up_completed boolean not null default false,
  created_at          timestamptz not null default clock_timestamp(),
  closed_at           timestamptz
);
create index if not exists care_episodes_patient_idx on public.care_episodes (patient_id, created_at desc);
create index if not exists care_episodes_hospital_idx on public.care_episodes (hospital_id, created_at desc);

create table if not exists public.care_access_options (
  id                   uuid primary key default gen_random_uuid(),
  care_request_id      uuid not null references public.care_requests(id) on delete cascade,
  hospital_id          uuid not null references public.hospitals(id) on delete restrict,
  department_id        uuid references public.departments(id) on delete set null,
  session_id           uuid references public.slots(id) on delete set null,
  distance_km          numeric(8,2),
  queue_wait_minutes   integer,
  queue_observed_at    timestamptz,
  cost_band            text,
  cost_verified_at     timestamptz,
  accessibility       text[] not null default '{}',
  languages            text[] not null default '{}',
  capability_matched   boolean not null default false,
  eligible             boolean not null default false,
  freshness            text not null default 'unavailable' check (freshness in ('fresh','ageing','stale','unavailable','simulated')),
  freshness_label      text not null,
  reasons              jsonb not null default '[]'::jsonb,
  status               text not null default 'offered' check (status in ('offered','selected','expired','declined')),
  offered_at           timestamptz not null default clock_timestamp(),
  expires_at           timestamptz,
  selected_at          timestamptz
);
create index if not exists care_access_options_request_idx on public.care_access_options (care_request_id, eligible desc, offered_at desc);
create index if not exists care_access_options_hospital_idx on public.care_access_options (hospital_id, offered_at desc);

create table if not exists public.care_state_transitions (
  id              bigint generated always as identity primary key,
  care_request_id uuid not null references public.care_requests(id) on delete cascade,
  previous_state  text,
  new_state       text not null,
  action          text not null,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_role      text not null,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default clock_timestamp(),
  constraint care_transition_states_ck check (
    (previous_state is null or previous_state in ('REQUESTED','SCREENED','OPTIONS_OFFERED','PATIENT_SELECTED','REFERRAL_SUBMITTED','ACKNOWLEDGED','INFO_REQUESTED','ACCEPTED','REDIRECTED','SLOT_OFFERED','BOOKED','REMINDER','RESCHEDULED','CANCELLED','ARRIVED','NO_SHOW','SERVICE_COMPLETED','FOLLOW_UP_OPEN','CLOSED'))
    and new_state in ('REQUESTED','SCREENED','OPTIONS_OFFERED','PATIENT_SELECTED','REFERRAL_SUBMITTED','ACKNOWLEDGED','INFO_REQUESTED','ACCEPTED','REDIRECTED','SLOT_OFFERED','BOOKED','REMINDER','RESCHEDULED','CANCELLED','ARRIVED','NO_SHOW','SERVICE_COMPLETED','FOLLOW_UP_OPEN','CLOSED')
  )
);
create index if not exists care_state_transitions_request_idx on public.care_state_transitions (care_request_id, created_at);

create table if not exists public.hospital_capacity_signals (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references public.hospitals(id) on delete cascade,
  service_slug       text,
  available          boolean,
  queue_wait_minutes integer,
  waiting_count      integer,
  note               text,
  source             text not null check (source in ('hospital_published','flowcare_verified')),
  updated_at         timestamptz not null default clock_timestamp(),
  expires_at         timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  constraint capacity_signal_numbers_ck check (
    (queue_wait_minutes is null or queue_wait_minutes >= 0)
    and (waiting_count is null or waiting_count >= 0)
  )
);
create index if not exists hospital_capacity_signals_lookup_idx on public.hospital_capacity_signals (hospital_id, service_slug, updated_at desc);

create table if not exists public.care_tasks (
  id             uuid primary key default gen_random_uuid(),
  care_request_id uuid not null references public.care_requests(id) on delete cascade,
  episode_id     uuid references public.care_episodes(id) on delete set null,
  patient_id     uuid not null references auth.users(id) on delete restrict,
  hospital_id    uuid references public.hospitals(id) on delete restrict,
  owner_type     text not null check (owner_type in ('patient','hospital','system')),
  owner_id       uuid references auth.users(id) on delete set null,
  task_type      text not null check (task_type in ('missing_document','transport','language','accessibility','referral_information','coverage','appointment','follow_up','other')),
  title          text not null check (length(btrim(title)) between 1 and 160),
  description    text,
  status         text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  deadline       timestamptz,
  resolution     text,
  created_at     timestamptz not null default clock_timestamp(),
  updated_at     timestamptz not null default clock_timestamp(),
  completed_at   timestamptz
);
create index if not exists care_tasks_patient_idx on public.care_tasks (patient_id, status, updated_at desc);
create index if not exists care_tasks_hospital_idx on public.care_tasks (hospital_id, status, updated_at desc);

alter table public.care_requests enable row level security;
alter table public.care_episodes enable row level security;
alter table public.care_access_options enable row level security;
alter table public.care_state_transitions enable row level security;
alter table public.hospital_capacity_signals enable row level security;
alter table public.care_tasks enable row level security;

revoke all on public.care_requests, public.care_episodes, public.care_access_options,
  public.care_state_transitions, public.hospital_capacity_signals, public.care_tasks
  from anon, authenticated;
grant select on public.care_requests, public.care_episodes, public.care_access_options,
  public.care_state_transitions, public.care_tasks to authenticated;
grant select on public.hospital_capacity_signals to anon, authenticated;

do $$ begin
  create policy care_requests_read on public.care_requests for select to authenticated
    using (
      patient_id = auth.uid()
      or (selected_hospital_id is not null and private.allowed(selected_hospital_id, 'appointments:read'))
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy care_episodes_read on public.care_episodes for select to authenticated
    using (
      patient_id = auth.uid()
      or (hospital_id is not null and private.allowed(hospital_id, 'appointments:read'))
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy care_options_read on public.care_access_options for select to authenticated
    using (
      exists (select 1 from public.care_requests r where r.id = care_request_id and r.patient_id = auth.uid())
      or private.allowed(hospital_id, 'appointments:read')
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy care_transitions_read on public.care_state_transitions for select to authenticated
    using (
      exists (select 1 from public.care_requests r where r.id = care_request_id and r.patient_id = auth.uid())
      or exists (select 1 from public.care_requests r where r.id = care_request_id and r.selected_hospital_id is not null and private.allowed(r.selected_hospital_id, 'appointments:read'))
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy care_tasks_read on public.care_tasks for select to authenticated
    using (
      patient_id = auth.uid()
      or (hospital_id is not null and private.allowed(hospital_id, 'appointments:read'))
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy capacity_signals_read on public.hospital_capacity_signals for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

create or replace function private.care_transition_allowed(p_from text, p_action text, p_actor text)
returns text language plpgsql immutable set search_path to '' as $$
declare v_to text;
begin
  v_to := case
    when p_action = 'screen' and p_from = 'REQUESTED' and p_actor = 'system' then 'SCREENED'
    when p_action = 'offer_options' and p_from = 'SCREENED' and p_actor = 'system' then 'OPTIONS_OFFERED'
    when p_action = 'select_option' and p_from = 'OPTIONS_OFFERED' and p_actor = 'patient' then 'PATIENT_SELECTED'
    when p_action = 'submit_referral' and p_from = 'PATIENT_SELECTED' and p_actor in ('patient','system') then 'REFERRAL_SUBMITTED'
    when p_action = 'acknowledge' and p_from in ('REFERRAL_SUBMITTED','INFO_REQUESTED') and p_actor = 'hospital' then 'ACKNOWLEDGED'
    when p_action = 'request_info' and p_from in ('REFERRAL_SUBMITTED','ACKNOWLEDGED','ACCEPTED') and p_actor = 'hospital' then 'INFO_REQUESTED'
    when p_action = 'provide_info' and p_from = 'INFO_REQUESTED' and p_actor = 'patient' then 'REFERRAL_SUBMITTED'
    when p_action = 'accept' and p_from in ('ACKNOWLEDGED','REFERRAL_SUBMITTED') and p_actor = 'hospital' then 'ACCEPTED'
    when p_action = 'redirect' and p_from in ('ACKNOWLEDGED','ACCEPTED','REFERRAL_SUBMITTED') and p_actor = 'hospital' then 'REDIRECTED'
    when p_action = 'offer_slot' and p_from in ('ACCEPTED','REDIRECTED') and p_actor = 'hospital' then 'SLOT_OFFERED'
    when p_action = 'book' and p_from in ('SLOT_OFFERED','RESCHEDULED') and p_actor = 'patient' then 'BOOKED'
    when p_action = 'remind' and p_from = 'BOOKED' and p_actor = 'system' then 'REMINDER'
    when p_action = 'reschedule' and p_from in ('BOOKED','REMINDER') and p_actor in ('patient','hospital') then 'RESCHEDULED'
    when p_action = 'arrive' and p_from in ('BOOKED','REMINDER','RESCHEDULED') and p_actor = 'hospital' then 'ARRIVED'
    when p_action = 'no_show' and p_from in ('BOOKED','REMINDER','RESCHEDULED') and p_actor = 'hospital' then 'NO_SHOW'
    when p_action = 'complete' and p_from = 'ARRIVED' and p_actor = 'hospital' then 'SERVICE_COMPLETED'
    when p_action = 'open_follow_up' and p_from = 'SERVICE_COMPLETED' and p_actor in ('hospital','system') then 'FOLLOW_UP_OPEN'
    when p_action = 'close' and p_from in ('SERVICE_COMPLETED','FOLLOW_UP_OPEN') and p_actor in ('patient','hospital','system') then 'CLOSED'
    when p_action = 'cancel' and p_from in ('REQUESTED','SCREENED','OPTIONS_OFFERED','PATIENT_SELECTED','REFERRAL_SUBMITTED','ACKNOWLEDGED','INFO_REQUESTED','ACCEPTED','SLOT_OFFERED','BOOKED','REMINDER','RESCHEDULED') and p_actor in ('patient','hospital') then 'CANCELLED'
    else null
  end;
  return v_to;
end $$;

create or replace function private.create_care_request(
  p_specialty text, p_service_type text, p_location text, p_start date, p_end date,
  p_time_range text, p_budget text, p_accessibility text[], p_languages text[],
  p_coverage text, p_referral_required boolean
)
returns public.care_requests language plpgsql security definer set search_path to '' as $$
declare actor uuid := private.actor(); v public.care_requests;
begin
  if p_service_type is null or length(btrim(p_service_type)) not between 1 and 120 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  insert into public.care_requests(
    patient_id, specialty, service_type, location, preferred_start_date, preferred_end_date,
    preferred_time_range, budget_constraint, accessibility_requirements, language_preference,
    coverage, referral_required
  ) values (
    actor, nullif(btrim(p_specialty),''), btrim(p_service_type), nullif(btrim(p_location),''), p_start, p_end,
    nullif(btrim(p_time_range),''), nullif(btrim(p_budget),''), coalesce(p_accessibility,'{}'), coalesce(p_languages,'{}'),
    nullif(btrim(p_coverage),''), p_referral_required
  ) returning * into v;
  insert into public.care_state_transitions(care_request_id, previous_state, new_state, action, actor_id, actor_role, metadata)
    values(v.id, null, 'REQUESTED', 'create', actor, 'patient', '{}'::jsonb);
  return v;
end $$;
create or replace function public.create_care_request(
  p_specialty text, p_service_type text, p_location text default null, p_start date default null, p_end date default null,
  p_time_range text default null, p_budget text default null, p_accessibility text[] default '{}', p_languages text[] default '{}',
  p_coverage text default null, p_referral_required boolean default null
) returns public.care_requests language sql set search_path to '' as $$
  select private.create_care_request(p_specialty,p_service_type,p_location,p_start,p_end,p_time_range,p_budget,p_accessibility,p_languages,p_coverage,p_referral_required)
$$;

create or replace function private.save_care_access_options(p_request uuid, p_options jsonb)
returns setof public.care_access_options language plpgsql security definer set search_path to '' as $$
declare actor uuid := private.actor(); item jsonb;
begin
  if not exists (select 1 from public.care_requests where id=p_request and patient_id=actor) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  delete from public.care_access_options where care_request_id=p_request;
  for item in select * from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) loop
    if not exists (select 1 from public.hospitals h where h.id=(item->>'hospital_id')::uuid) then
      raise exception using errcode='P0001', message='INVALID_OPTION';
    end if;
    if nullif(item->>'department_id','') is not null and not exists (
      select 1 from public.departments d where d.id=(item->>'department_id')::uuid and d.hospital_id=(item->>'hospital_id')::uuid
    ) then
      raise exception using errcode='P0001', message='INVALID_OPTION';
    end if;
    if nullif(item->>'session_id','') is not null and not exists (
      select 1 from public.slots s join public.departments d on d.id=s.department_id
      where s.id=(item->>'session_id')::uuid and d.hospital_id=(item->>'hospital_id')::uuid
        and (nullif(item->>'department_id','') is null or s.department_id=(item->>'department_id')::uuid)
    ) then
      raise exception using errcode='P0001', message='INVALID_OPTION';
    end if;
    if coalesce((item->>'eligible')::boolean,false) and not coalesce((item->>'capability_matched')::boolean,false) then
      raise exception using errcode='P0001', message='INVALID_OPTION';
    end if;
    insert into public.care_access_options(
      care_request_id,hospital_id,department_id,session_id,distance_km,queue_wait_minutes,queue_observed_at,
      cost_band,cost_verified_at,accessibility,languages,capability_matched,eligible,freshness,freshness_label,
      reasons,status,offered_at,expires_at
    ) values (
      p_request,(item->>'hospital_id')::uuid,nullif(item->>'department_id','')::uuid,nullif(item->>'session_id','')::uuid,
      nullif(item->>'distance_km','')::numeric,nullif(item->>'queue_wait_minutes','')::integer,nullif(item->>'queue_observed_at','')::timestamptz,
      nullif(item->>'cost_band',''),nullif(item->>'cost_verified_at','')::timestamptz,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(item->'accessibility','[]'::jsonb)) x),'{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(item->'languages','[]'::jsonb)) x),'{}'),
      coalesce((item->>'capability_matched')::boolean,false),coalesce((item->>'eligible')::boolean,false),
      coalesce(item->>'freshness','unavailable'),coalesce(item->>'freshness_label','Capacity update unavailable'),
      coalesce(item->'reasons','[]'::jsonb),coalesce(item->>'status','offered'),
      coalesce((item->>'offered_at')::timestamptz,clock_timestamp()),nullif(item->>'expires_at','')::timestamptz
    );
  end loop;
  return query select * from public.care_access_options where care_request_id=p_request order by eligible desc, offered_at desc;
end $$;
create or replace function public.save_care_access_options(p_request uuid, p_options jsonb)
returns setof public.care_access_options language sql set search_path to '' as $$ select * from private.save_care_access_options(p_request,p_options) $$;

grant execute on function public.save_care_access_options(uuid,jsonb) to authenticated;

create or replace function private.transition_care_request(
  p_id uuid, p_action text, p_option uuid, p_appointment uuid, p_reason text,
  p_metadata jsonb, p_expected_version integer
)
returns public.care_requests language plpgsql security definer set search_path to '' as $$
declare actor uuid := private.actor(); v public.care_requests; v_before text; v_to text; v_option public.care_access_options; v_now timestamptz := clock_timestamp(); v_actor_role text; v_episode uuid;
begin
  select * into v from public.care_requests where id=p_id for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  if v.patient_id <> actor and (v.selected_hospital_id is null or not private.allowed(v.selected_hospital_id, 'appointments:manage')) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if p_expected_version is not null and p_expected_version <> v.version then
    raise exception using errcode='P0001', message='VERSION_CONFLICT';
  end if;
  v_before := v.state;
  v_actor_role := case when p_action in ('screen','offer_options','remind','open_follow_up') then 'system' when v.patient_id = actor then 'patient' else 'hospital' end;
  v_to := private.care_transition_allowed(v.state, p_action, case when p_action in ('screen','offer_options','remind','open_follow_up') and v.patient_id <> actor then 'system' else v_actor_role end);
  if v_to is null then raise exception using errcode='P0001', message='INVALID_TRANSITION'; end if;
  if p_action in ('request_info','redirect','cancel','reschedule','no_show','provide_info') and nullif(btrim(p_reason),'') is null then
    raise exception using errcode='P0001', message='REASON_REQUIRED';
  end if;
  if p_action in ('select_option','offer_slot') then
    if p_option is null then raise exception using errcode='P0001', message='OPTION_REQUIRED'; end if;
    select * into v_option from public.care_access_options where id=p_option and care_request_id=v.id and eligible for update;
    if not found then raise exception using errcode='P0001', message='OPTION_NOT_FOUND'; end if;
    update public.care_access_options set status = case when id=p_option then 'selected' else 'declined' end,
      selected_at = case when id=p_option then v_now else selected_at end where care_request_id=v.id and status='offered';
    v.selected_hospital_id := v_option.hospital_id; v.selected_option_id := v_option.id;
  end if;
  if p_action = 'book' and p_appointment is not null then v.appointment_id := p_appointment; end if;
  v.state := v_to; v.version := v.version + 1; v.updated_at := v_now;
  if v_to = 'CLOSED' then v.closed_at := v_now; end if;
  if v.episode_id is null and v.selected_hospital_id is not null and v.state in ('PATIENT_SELECTED','REFERRAL_SUBMITTED','ACKNOWLEDGED','ACCEPTED','SLOT_OFFERED','BOOKED') then
    insert into public.care_episodes(care_request_id,patient_id,hospital_id,appointment_id)
      values(v.id,v.patient_id,v.selected_hospital_id,v.appointment_id)
      returning id into v_episode;
    v.episode_id := v_episode;
  elsif v.episode_id is not null then
    update public.care_episodes set appointment_id=coalesce(v.appointment_id,appointment_id),
      follow_up_required=case when v.state='FOLLOW_UP_OPEN' then true else follow_up_required end,
      closed_at=case when v.state='CLOSED' then v_now else closed_at end
      where id=v.episode_id;
  end if;
  update public.care_requests set state=v.state, selected_hospital_id=v.selected_hospital_id, selected_option_id=v.selected_option_id,
    appointment_id=v.appointment_id, episode_id=v.episode_id, version=v.version, updated_at=v.updated_at, closed_at=v.closed_at where id=v.id returning * into v;
  insert into public.care_state_transitions(care_request_id,previous_state,new_state,action,actor_id,actor_role,reason,metadata)
    values(v.id,v_before,v.state,p_action,actor,v_actor_role,nullif(btrim(p_reason),''),coalesce(p_metadata,'{}'::jsonb));
  return v;
end $$;
create or replace function public.transition_care_request(
  p_id uuid, p_action text, p_option uuid default null, p_appointment uuid default null,
  p_reason text default null, p_metadata jsonb default '{}'::jsonb, p_expected_version integer default null
) returns public.care_requests language sql set search_path to '' as $$
  select private.transition_care_request(p_id,p_action,p_option,p_appointment,p_reason,p_metadata,p_expected_version)
$$;

create or replace function private.publish_capacity_signal(
  p_hospital uuid, p_service text, p_available boolean, p_wait integer, p_waiting integer, p_note text, p_expires timestamptz
) returns public.hospital_capacity_signals language plpgsql security definer set search_path to '' as $$
declare actor uuid := private.actor(); v public.hospital_capacity_signals;
begin
  if not private.allowed(p_hospital, 'queue:manage') and not private.allowed(p_hospital, 'facts:manage') then
    raise exception using errcode='P0001', message='FORBIDDEN';
  end if;
  insert into public.hospital_capacity_signals(hospital_id,service_slug,available,queue_wait_minutes,waiting_count,note,source,updated_at,expires_at,created_by)
  values(p_hospital,nullif(btrim(p_service),''),p_available,p_wait,p_waiting,nullif(btrim(p_note),''),'hospital_published',clock_timestamp(),p_expires,actor)
  returning * into v;
  return v;
end $$;
create or replace function public.publish_capacity_signal(
  p_hospital uuid, p_service text default null, p_available boolean default null, p_wait integer default null,
  p_waiting integer default null, p_note text default null, p_expires timestamptz default null
) returns public.hospital_capacity_signals language sql set search_path to '' as $$
  select private.publish_capacity_signal(p_hospital,p_service,p_available,p_wait,p_waiting,p_note,p_expires)
$$;

create or replace function private.create_care_task(
  p_request uuid, p_episode uuid, p_patient uuid, p_hospital uuid, p_owner_type text, p_owner uuid,
  p_task_type text, p_title text, p_description text, p_deadline timestamptz
) returns public.care_tasks language plpgsql security definer set search_path to '' as $$
declare actor uuid := private.actor(); v public.care_tasks;
begin
  if actor <> p_patient and (p_hospital is null or not private.allowed(p_hospital,'appointments:manage')) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  insert into public.care_tasks(care_request_id,episode_id,patient_id,hospital_id,owner_type,owner_id,task_type,title,description,deadline)
    values(p_request,p_episode,p_patient,p_hospital,p_owner_type,p_owner,p_task_type,btrim(p_title),nullif(btrim(p_description),''),p_deadline)
    returning * into v;
  return v;
end $$;
create or replace function public.create_care_task(
  p_request uuid, p_episode uuid, p_patient uuid, p_hospital uuid, p_owner_type text, p_owner uuid,
  p_task_type text, p_title text, p_description text default null, p_deadline timestamptz default null
) returns public.care_tasks language sql set search_path to '' as $$
  select private.create_care_task(p_request,p_episode,p_patient,p_hospital,p_owner_type,p_owner,p_task_type,p_title,p_description,p_deadline)
$$;

create or replace function private.update_care_task(p_id uuid, p_status text, p_resolution text)
returns public.care_tasks language plpgsql security definer set search_path to '' as $$
declare actor uuid := private.actor(); v public.care_tasks; v_before text;
begin
  select * into v from public.care_tasks where id=p_id for update;
  if not found or not (v.patient_id=actor or v.owner_id=actor or (v.hospital_id is not null and private.allowed(v.hospital_id,'appointments:manage'))) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  select state into v_before from public.care_requests where id=v.care_request_id for update;
  update public.care_tasks set status=p_status, resolution=coalesce(nullif(btrim(p_resolution),''),resolution), updated_at=clock_timestamp(), completed_at=case when p_status='completed' then coalesce(completed_at,clock_timestamp()) else null end where id=p_id returning * into v;
  if p_status = 'completed' and v_before = 'FOLLOW_UP_OPEN' and not exists (select 1 from public.care_tasks where care_request_id=v.care_request_id and status <> 'completed') then
    update public.care_requests set state='CLOSED', closed_at=clock_timestamp(), updated_at=clock_timestamp(), version=version+1
      where id=v.care_request_id and state='FOLLOW_UP_OPEN';
    update public.care_episodes set follow_up_completed=true, closed_at=clock_timestamp()
      where id=v.episode_id;
    insert into public.care_state_transitions(care_request_id,previous_state,new_state,action,actor_id,actor_role,reason,metadata)
      values(v.care_request_id,'FOLLOW_UP_OPEN','CLOSED', 'close', actor,
        case when actor=(select patient_id from public.care_requests where id=v.care_request_id) then 'patient' else 'hospital' end,
        nullif(btrim(p_resolution),''), jsonb_build_object('task_id',v.id));
  end if;
  return v;
end $$;
create or replace function public.update_care_task(p_id uuid, p_status text, p_resolution text default null)
returns public.care_tasks language sql set search_path to '' as $$ select private.update_care_task(p_id,p_status,p_resolution) $$;

grant execute on function public.create_care_request(text,text,text,date,date,text,text,text[],text[],text,boolean) to authenticated;
grant execute on function public.transition_care_request(uuid,text,uuid,uuid,text,jsonb,integer) to authenticated;
grant execute on function public.publish_capacity_signal(uuid,text,boolean,integer,integer,text,timestamptz) to authenticated;
grant execute on function public.create_care_task(uuid,uuid,uuid,uuid,text,uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.update_care_task(uuid,text,text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0017_care_access_exchange') on conflict (version) do nothing;
