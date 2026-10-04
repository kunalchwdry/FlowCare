-- Care Access system transitions and authorization hardening.
--
-- 0017 made system actions look like system actions based only on the action
-- name. That would let an authenticated patient call the normal transition
-- RPC with `screen` or `offer_options`. This migration makes the distinction
-- explicit: only the service-role-only wrapper can establish a system
-- transition context; the normal authenticated RPC derives the actor role
-- from the caller and remains unable to perform system-only actions.

create or replace function private.transition_care_request(
  p_id uuid, p_action text, p_option uuid, p_appointment uuid, p_reason text,
  p_metadata jsonb, p_expected_version integer
)
returns public.care_requests language plpgsql security definer set search_path to '' as $$
declare
  actor uuid := private.actor();
  v public.care_requests;
  v_before text;
  v_to text;
  v_option public.care_access_options;
  v_now timestamptz := clock_timestamp();
  v_actor_role text;
  v_episode uuid;
  v_system boolean := coalesce(current_setting('flowcare.system_transition', true), '') = 'true';
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

  -- A system role is not inferred from p_action. It exists only inside the
  -- service-role wrapper below, which sets this transaction-local marker.
  v_actor_role := case
    when v_system and p_action in ('screen','offer_options','remind','open_follow_up') then 'system'
    when v.patient_id = actor then 'patient'
    else 'hospital'
  end;
  v_to := private.care_transition_allowed(v.state, p_action, v_actor_role);
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

create or replace function public.transition_care_request_system(
  p_id uuid, p_actor uuid, p_action text, p_option uuid default null, p_appointment uuid default null,
  p_reason text default null, p_metadata jsonb default '{}'::jsonb, p_expected_version integer default null
) returns public.care_requests language plpgsql security definer set search_path to '' as $$
declare
  v public.care_requests;
begin
  -- The function is also protected by EXECUTE privileges below. Keep this
  -- check in the body so a future grant cannot accidentally turn it into a
  -- caller-controlled privilege escalation.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode='P0001', message='FORBIDDEN';
  end if;
  if p_action not in ('screen','offer_options','remind','open_follow_up') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;

  -- private.actor() deliberately validates the user in auth.users. Setting
  -- the claims only for this transaction lets the existing RLS-aware
  -- transition implementation record the real patient actor without
  -- exposing a client-settable system role.
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('flowcare.system_transition', 'true', true);
  select * into v from private.transition_care_request(
    p_id, p_action, p_option, p_appointment, p_reason, p_metadata, p_expected_version
  );
  return v;
end $$;

revoke all on function public.transition_care_request_system(uuid,uuid,text,uuid,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.transition_care_request_system(uuid,uuid,text,uuid,uuid,text,jsonb,integer) to service_role;

insert into public.fc_schema_migrations(version) values ('0018_care_access_system_transition') on conflict (version) do nothing;
