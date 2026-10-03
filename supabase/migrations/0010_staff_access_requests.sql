-- ===========================================================================
-- 0010_staff_access_requests.sql — persistent staff onboarding queue
-- ===========================================================================
-- Staff registration used to write a local JSON file. That works in a single
-- dev process but disappears or lands on a different instance on Vercel. The
-- request queue belongs in Supabase; it is not a membership and cannot grant
-- access by itself.
-- ===========================================================================

create table if not exists public.staff_access_requests (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals(id) on delete restrict,
  email          text not null,
  full_name      text not null,
  requested_role text not null check (requested_role in ('hospital_admin','doctor','receptionist','nurse','staff')),
  staff_id       text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,
  note           text
);

create index if not exists staff_access_requests_hospital_status_idx
  on public.staff_access_requests (hospital_id, status, created_at desc);
create index if not exists staff_access_requests_email_idx
  on public.staff_access_requests (lower(email));
create unique index if not exists staff_access_requests_open_person_idx
  on public.staff_access_requests (hospital_id, lower(email))
  where status = 'pending';

alter table public.staff_access_requests enable row level security;
grant select on public.staff_access_requests to authenticated;
revoke insert, update, delete on public.staff_access_requests from anon, authenticated;

do $$ begin
  create policy staff_access_requests_admin_read
    on public.staff_access_requests for select to authenticated
    using (private.allowed(hospital_id, 'memberships:manage'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy staff_access_requests_subject_read
    on public.staff_access_requests for select to authenticated
    using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
exception when duplicate_object then null; end $$;

create or replace function public.submit_staff_access_request(
  p_hospital_id    uuid,
  p_email          text,
  p_full_name      text,
  p_requested_role text,
  p_staff_id       text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_existing public.staff_access_requests;
  v_row public.staff_access_requests;
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
  v_staff_id text := nullif(trim(p_staff_id), '');
begin
  if p_hospital_id is null then
    raise exception using errcode = '22023', message = 'Choose a hospital.';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'Enter your full name.';
  end if;
  if position('@' in v_email) < 2 then
    raise exception using errcode = '22023', message = 'Enter a valid work email.';
  end if;
  if p_requested_role not in ('hospital_admin','doctor','receptionist','nurse','staff') then
    raise exception using errcode = '22023', message = 'Choose a valid staff role.';
  end if;

  select * into v_existing
    from public.staff_access_requests r
   where r.hospital_id = p_hospital_id
     and lower(r.email) = v_email
     and r.status = 'pending'
   order by r.created_at desc
   limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'duplicate', true,
      'created_at', v_existing.created_at
    );
  end if;

  insert into public.staff_access_requests (
    hospital_id, email, full_name, requested_role, staff_id
  ) values (
    p_hospital_id, v_email, v_name, p_requested_role, v_staff_id
  ) returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'duplicate', false,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.submit_staff_access_request(uuid,text,text,text,text) from public;
grant execute on function public.submit_staff_access_request(uuid,text,text,text,text) to anon, authenticated;

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

insert into public.fc_schema_migrations(version) values ('0010_staff_access_requests')
  on conflict (version) do nothing;
