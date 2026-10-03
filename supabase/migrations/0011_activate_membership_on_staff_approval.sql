-- ===========================================================================
-- 0011_activate_membership_on_staff_approval.sql — complete staff approval
-- ===========================================================================
-- Approving a staff request must do two things atomically: record the review
-- decision and activate the applicant's hospital membership. Previously the
-- queue status changed but no membership was created, so an approved person
-- still could not sign in to the hospital portal.
-- ===========================================================================

create or replace function public.decide_staff_access_request(
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row public.staff_access_requests;
  v_updated public.staff_access_requests;
  v_user_id uuid;
  v_membership public.memberships;
  v_permissions text[];
begin
  if p_decision not in ('approved','rejected') then
    raise exception using errcode = '22023', message = 'Invalid access decision.';
  end if;

  select * into v_row
    from public.staff_access_requests
   where id = p_request_id;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Access request not found.';
  end if;
  if not private.allowed(v_row.hospital_id, 'memberships:manage') then
    raise exception using errcode = '42501', message = 'You cannot decide this request.';
  end if;
  if v_row.status <> 'pending' then
    raise exception using errcode = '40001', message = 'That request has already been decided.';
  end if;

  if p_decision = 'approved' then
    -- Do not activate an account that has not confirmed its email address.
    select u.id into v_user_id
      from auth.users u
     where lower(u.email) = lower(v_row.email)
       and u.email_confirmed_at is not null
     limit 1;
    if v_user_id is null then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_CONFIRMED';
    end if;

    v_permissions := case v_row.requested_role
      when 'hospital_admin' then array[
        'appointments:read','appointments:manage','queue:read','queue:manage',
        'memberships:manage','reviews:moderate','facts:manage','corrections:review'
      ]::text[]
      when 'receptionist' then array['appointments:read','appointments:manage','queue:read','queue:manage']::text[]
      when 'nurse' then array['appointments:read','queue:read','queue:manage']::text[]
      when 'doctor' then array['appointments:read','queue:read']::text[]
      else array['appointments:read','queue:read']::text[]
    end;

    select * into v_membership
      from public.memberships
     where hospital_id = v_row.hospital_id
       and user_id = v_user_id
     for update;

    if v_membership.user_id is null then
      insert into public.memberships (
        hospital_id, user_id, status, permissions, approved_by
      ) values (
        v_row.hospital_id, v_user_id, 'active', v_permissions, v_actor
      ) returning * into v_membership;
    else
      -- Multiple approved requests for one person cannot downgrade access.
      select coalesce(array_agg(distinct permission order by permission), '{}'::text[])
        into v_permissions
        from unnest(coalesce(v_membership.permissions, '{}'::text[]) || v_permissions) as p(permission);

      update public.memberships
         set status = 'active',
             permissions = v_permissions,
             approved_by = v_actor,
             updated_at = clock_timestamp(),
             version = version + 1
       where hospital_id = v_row.hospital_id
         and user_id = v_user_id
       returning * into v_membership;
    end if;

    insert into public.membership_events (
      hospital_id, subject_id, actor_id, action, details
    ) values (
      v_row.hospital_id, v_user_id, v_actor, 'active',
      jsonb_build_object('permissions', v_membership.permissions, 'source', 'staff_access_request')
    );
  end if;

  update public.staff_access_requests
     set status = p_decision,
         decided_at = clock_timestamp(),
         decided_by = v_actor,
         note = nullif(trim(p_note), '')
   where id = p_request_id
  returning * into v_updated;

  return jsonb_build_object(
    'id', v_updated.id,
    'status', v_updated.status,
    'decided_at', v_updated.decided_at,
    'decided_by', v_updated.decided_by,
    'note', v_updated.note
  );
end;
$$;

revoke all on function public.decide_staff_access_request(uuid,text,text) from public;
grant execute on function public.decide_staff_access_request(uuid,text,text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0011_activate_membership_on_staff_approval')
  on conflict (version) do nothing;
