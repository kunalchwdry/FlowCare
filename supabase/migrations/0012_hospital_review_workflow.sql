-- ===========================================================================
-- 0012_hospital_review_workflow.sql — FlowCare reviewer queue
-- ===========================================================================
-- Registration is still an intake queue. This migration adds the reviewer
-- evidence fields and the only production write paths for listing and deciding
-- applications. A reviewer can approve an existing claim or create a new
-- hospital listing, then provision the applicant's first membership.
-- ===========================================================================

alter table public.hospital_registration_requests
  add column if not exists evidence_note text,
  add column if not exists license_number text,
  add column if not exists license_authority text,
  add column if not exists license_expires_on date;

comment on column public.hospital_registration_requests.evidence_note is
  'Applicant-supplied verification context. It is evidence for a human reviewer, never proof by itself.';
comment on column public.hospital_registration_requests.license_number is
  'License or registration number supplied by the applicant.';
comment on column public.hospital_registration_requests.license_authority is
  'Authority that issued the supplied license or registration.';

-- The original 0009 function remains valid for older clients. This overload
-- persists the additional reviewer fields from the current registration form.
create or replace function public.submit_hospital_registration(
  p_hospital_id      uuid,
  p_proposed_name    text,
  p_proposed_city    text,
  p_address          text,
  p_website          text,
  p_admin_name       text,
  p_admin_email      text,
  p_admin_phone      text,
  p_evidence_note    text,
  p_license_number   text,
  p_license_authority text,
  p_license_expires_on date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_result jsonb;
  v_id uuid;
begin
  v_result := public.submit_hospital_registration(
    p_hospital_id, p_proposed_name, p_proposed_city, p_address,
    p_website, p_admin_name, p_admin_email, p_admin_phone
  );
  v_id := nullif(v_result ->> 'id', '')::uuid;

  update public.hospital_registration_requests
     set evidence_note = nullif(trim(p_evidence_note), ''),
         license_number = nullif(trim(p_license_number), ''),
         license_authority = nullif(trim(p_license_authority), ''),
         license_expires_on = p_license_expires_on,
         updated_at = clock_timestamp()
   where id = v_id
     and coalesce((v_result ->> 'duplicate')::boolean, false) = false;

  return v_result;
end;
$$;

revoke all on function public.submit_hospital_registration(uuid,text,text,text,text,text,text,text,text,text,text,date) from public;
grant execute on function public.submit_hospital_registration(uuid,text,text,text,text,text,text,text,text,text,text,date) to anon, authenticated;

-- A dedicated app_metadata flag keeps a FlowCare reviewer separate from a
-- hospital administrator. The database repeats this check; a hidden link is
-- not an authorization boundary.
create or replace function private.flowcare_reviewer()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'flowcare_reviewer',
    'false'
  ) = 'true';
$$;

create or replace function public.list_hospital_registration_requests(p_status text default null)
returns table (
  id uuid,
  hospital_id uuid,
  hospital_name text,
  proposed_name text,
  proposed_city text,
  address text,
  website text,
  admin_name text,
  admin_email text,
  admin_phone text,
  evidence_note text,
  license_number text,
  license_authority text,
  license_expires_on date,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text
)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.flowcare_reviewer() then
    raise exception using errcode = '42501', message = 'FlowCare reviewer access required.';
  end if;

  return query
  select r.id,
         r.hospital_id,
         h.name,
         r.proposed_name,
         r.proposed_city,
         r.address,
         r.website,
         r.admin_name,
         r.admin_email,
         r.admin_phone,
         r.evidence_note,
         r.license_number,
         r.license_authority,
         r.license_expires_on,
         r.status,
         r.created_at,
         r.updated_at,
         r.reviewed_at,
         r.reviewed_by,
         r.review_note
    from public.hospital_registration_requests r
    left join public.hospitals h on h.id = r.hospital_id
   where p_status is null or r.status = p_status
   order by case r.status when 'pending' then 0 when 'verifying' then 1 else 2 end,
            r.created_at desc;
end;
$$;

revoke all on function public.list_hospital_registration_requests(text) from public;
grant execute on function public.list_hospital_registration_requests(text) to authenticated;

create or replace function public.decide_hospital_registration(
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
  v_request public.hospital_registration_requests;
  v_hospital public.hospitals;
  v_user_id uuid;
  v_permissions text[] := array[
    'appointments:read','appointments:manage','queue:read','queue:manage',
    'memberships:manage','reviews:moderate','facts:manage','corrections:review'
  ]::text[];
  v_name text;
  v_new_hospital boolean := false;
begin
  if not private.flowcare_reviewer() then
    raise exception using errcode = '42501', message = 'FlowCare reviewer access required.';
  end if;
  if p_decision not in ('approved','rejected','verifying') then
    raise exception using errcode = '22023', message = 'Invalid hospital review decision.';
  end if;

  select * into v_request
    from public.hospital_registration_requests
   where id = p_request_id
   for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'Hospital registration not found.';
  end if;
  if v_request.status in ('approved','rejected') then
    raise exception using errcode = '40001', message = 'That hospital registration has already been decided.';
  end if;

  if p_decision = 'approved' then
    select u.id into v_user_id
      from auth.users u
     where lower(u.email) = lower(v_request.admin_email)
       and u.email_confirmed_at is not null
     limit 1;
    if v_user_id is null then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_CONFIRMED';
    end if;

    if v_request.hospital_id is null then
      v_new_hospital := true;
      v_name := trim(v_request.proposed_name);
      insert into public.hospitals (
        name, timezone, published, slug, city, address, website, phone
      ) values (
        v_name,
        'Asia/Kolkata',
        true,
        regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g') || '-' || substr(gen_random_uuid()::text, 1, 8),
        nullif(trim(v_request.proposed_city), ''),
        nullif(trim(v_request.address), ''),
        nullif(trim(v_request.website), ''),
        nullif(trim(v_request.admin_phone), '')
      ) returning * into v_hospital;
    else
      select * into v_hospital
        from public.hospitals
       where id = v_request.hospital_id
       for update;
      if v_hospital.id is null then
        raise exception using errcode = 'P0002', message = 'The claimed hospital no longer exists.';
      end if;

      -- Do not overwrite established directory facts with unreviewed intake
      -- data. Fill only fields that are currently empty, then publish the
      -- listing because a human has approved the claim.
      update public.hospitals
         set city = coalesce(city, nullif(trim(v_request.proposed_city), '')),
             address = coalesce(address, nullif(trim(v_request.address), '')),
             website = coalesce(website, nullif(trim(v_request.website), '')),
             phone = coalesce(phone, nullif(trim(v_request.admin_phone), '')),
             published = true
       where id = v_hospital.id
       returning * into v_hospital;
    end if;

    -- Approval creates or reactivates the first hospital administrator. It
    -- never changes an already granted membership to fewer permissions.
    if exists (
      select 1 from public.memberships
       where hospital_id = v_hospital.id and user_id = v_user_id
    ) then
      update public.memberships as m
         set status = 'active',
             permissions = (
               select coalesce(array_agg(distinct permission order by permission), '{}'::text[])
                 from unnest(coalesce(m.permissions, '{}'::text[]) || v_permissions) as p(permission)
             ),
             approved_by = v_actor,
             updated_at = clock_timestamp(),
             version = version + 1
       where m.hospital_id = v_hospital.id and m.user_id = v_user_id;
    else
      insert into public.memberships (
        hospital_id, user_id, status, permissions, approved_by
      ) values (
        v_hospital.id, v_user_id, 'active', v_permissions, v_actor
      );
    end if;

    insert into public.membership_events (
      hospital_id, subject_id, actor_id, action, details
    ) values (
      v_hospital.id, v_user_id, v_actor, 'active',
      jsonb_build_object('permissions', v_permissions, 'source', 'hospital_registration_review')
    );
  end if;

  update public.hospital_registration_requests
     set status = p_decision,
         updated_at = clock_timestamp(),
         reviewed_at = case when p_decision in ('approved','rejected') then clock_timestamp() else reviewed_at end,
         reviewed_by = case when p_decision in ('approved','rejected') then v_actor else reviewed_by end,
         review_note = nullif(trim(p_note), '')
   where id = v_request.id;

  insert into public.audit_events (
    actor_id, actor_role, action, entity, entity_id, metadata
  ) values (
    v_actor, 'admin', 'hospital_registration.' || p_decision,
    'hospital_registration_request', v_request.id::text,
    jsonb_build_object(
      'hospital_id', v_hospital.id,
      'new_hospital', v_new_hospital,
      'note', nullif(trim(p_note), '')
    )
  );

  return jsonb_build_object(
    'id', v_request.id,
    'status', p_decision,
    'hospital_id', v_hospital.id,
    'new_hospital', v_new_hospital,
    'reviewed_at', case when p_decision in ('approved','rejected') then clock_timestamp() else null end
  );
end;
$$;

revoke all on function public.decide_hospital_registration(uuid,text,text) from public;
grant execute on function public.decide_hospital_registration(uuid,text,text) to authenticated;

insert into public.fc_schema_migrations(version) values ('0012_hospital_review_workflow')
  on conflict (version) do nothing;
