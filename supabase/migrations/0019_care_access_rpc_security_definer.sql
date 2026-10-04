-- The public Care Access RPCs call functions in the private schema. Keep
-- private schema usage denied to end users, but make the public wrappers
-- SECURITY DEFINER so PostgreSQL can resolve and execute those functions.
-- Each private function still authenticates the actor and checks membership.

create or replace function public.create_care_request(
  p_specialty text, p_service_type text, p_location text default null, p_start date default null, p_end date default null,
  p_time_range text default null, p_budget text default null, p_accessibility text[] default '{}', p_languages text[] default '{}',
  p_coverage text default null, p_referral_required boolean default null
) returns public.care_requests language sql security definer set search_path to '' as $$
  select private.create_care_request(p_specialty,p_service_type,p_location,p_start,p_end,p_time_range,p_budget,p_accessibility,p_languages,p_coverage,p_referral_required)
$$;

create or replace function public.save_care_access_options(p_request uuid, p_options jsonb)
returns setof public.care_access_options language sql security definer set search_path to '' as $$
  select * from private.save_care_access_options(p_request,p_options)
$$;

create or replace function public.transition_care_request(
  p_id uuid, p_action text, p_option uuid default null, p_appointment uuid default null,
  p_reason text default null, p_metadata jsonb default '{}'::jsonb, p_expected_version integer default null
) returns public.care_requests language sql security definer set search_path to '' as $$
  select private.transition_care_request(p_id,p_action,p_option,p_appointment,p_reason,p_metadata,p_expected_version)
$$;

create or replace function public.publish_capacity_signal(
  p_hospital uuid, p_service text default null, p_available boolean default null, p_wait integer default null,
  p_waiting integer default null, p_note text default null, p_expires timestamptz default null
) returns public.hospital_capacity_signals language sql security definer set search_path to '' as $$
  select private.publish_capacity_signal(p_hospital,p_service,p_available,p_wait,p_waiting,p_note,p_expires)
$$;

create or replace function public.create_care_task(
  p_request uuid, p_episode uuid, p_patient uuid, p_hospital uuid, p_owner_type text, p_owner uuid,
  p_task_type text, p_title text, p_description text default null, p_deadline timestamptz default null
) returns public.care_tasks language sql security definer set search_path to '' as $$
  select private.create_care_task(p_request,p_episode,p_patient,p_hospital,p_owner_type,p_owner,p_task_type,p_title,p_description,p_deadline)
$$;

create or replace function public.update_care_task(p_id uuid, p_status text, p_resolution text default null)
returns public.care_tasks language sql security definer set search_path to '' as $$
  select private.update_care_task(p_id,p_status,p_resolution)
$$;

insert into public.fc_schema_migrations(version) values ('0019_care_access_rpc_security_definer') on conflict (version) do nothing;
