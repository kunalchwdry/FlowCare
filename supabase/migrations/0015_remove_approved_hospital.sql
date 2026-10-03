-- ===========================================================================
-- 0015_remove_approved_hospital.sql — reversible/traceable hospital removal
-- ===========================================================================
-- Removal is a soft removal: the listing is unpublished and active portal
-- memberships are revoked, while the hospital row, appointments and audit
-- history remain intact. This protects referential integrity and preserves
-- the reason a reviewer removed access.
-- ===========================================================================

alter table public.hospital_registration_requests
  drop constraint if exists hospital_registration_requests_status_check;

alter table public.hospital_registration_requests
  add constraint hospital_registration_requests_status_check
  check (status in ('pending','verifying','approved','rejected','removed'));

create or replace function public.remove_hospital_registration(
  p_request_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_request public.hospital_registration_requests;
  v_user_id uuid;
  v_hospital_id uuid;
begin
  if not private.flowcare_reviewer() then
    raise exception using errcode = '42501', message = 'FlowCare reviewer access required.';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'Add a reason before removing a hospital.';
  end if;

  select * into v_request
    from public.hospital_registration_requests
   where id = p_request_id
   for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'Hospital registration not found.';
  end if;
  if v_request.status <> 'approved' or v_request.hospital_id is null then
    raise exception using errcode = '40001', message = 'Only an approved hospital can be removed.';
  end if;

  v_hospital_id := v_request.hospital_id;

  update public.hospitals
     set published = false
   where id = v_hospital_id;

  for v_user_id in
    select user_id
      from public.memberships
     where hospital_id = v_hospital_id
       and status = 'active'
  loop
    update public.memberships
       set status = 'revoked',
           permissions = '{}'::text[],
           approved_by = v_actor,
           updated_at = clock_timestamp(),
           version = version + 1
     where hospital_id = v_hospital_id
       and user_id = v_user_id;

    insert into public.membership_events (
      hospital_id, subject_id, actor_id, action, details
    ) values (
      v_hospital_id, v_user_id, v_actor, 'revoked',
      jsonb_build_object('source', 'hospital_registration_removal', 'reason', trim(p_note))
    );
  end loop;

  update public.hospital_registration_requests
     set status = 'removed',
         reviewed_at = clock_timestamp(),
         reviewed_by = v_actor,
         review_note = trim(p_note),
         updated_at = clock_timestamp()
   where id = v_request.id;

  insert into public.audit_events (
    actor_id, actor_role, action, entity, entity_id, metadata
  ) values (
    v_actor, 'admin', 'hospital_registration.removed',
    'hospital_registration_request', v_request.id::text,
    jsonb_build_object('hospital_id', v_hospital_id, 'note', trim(p_note))
  );

  return jsonb_build_object(
    'id', v_request.id,
    'status', 'removed',
    'hospital_id', v_hospital_id
  );
end;
$$;

revoke all on function public.remove_hospital_registration(uuid,text) from public;
grant execute on function public.remove_hospital_registration(uuid,text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0015_remove_approved_hospital')
  on conflict (version) do nothing;
