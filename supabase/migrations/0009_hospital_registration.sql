-- ===========================================================================
-- 0009_hospital_registration.sql — hospital onboarding intake
-- ===========================================================================
-- A hospital may apply to claim an existing listing or request a new listing.
-- This table is intentionally an intake queue, not a membership table:
-- submitting a registration never grants portal access.
--
-- The public RPC is the only write path exposed to signed-out callers. It
-- validates and deduplicates the request inside the database, while review
-- and membership creation remain a separate, human-approved operation.
-- ===========================================================================

create table if not exists public.hospital_registration_requests (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid references public.hospitals(id) on delete restrict,
  proposed_name       text,
  proposed_city       text,
  address             text,
  website             text,
  admin_name          text not null,
  admin_email         text not null,
  admin_phone         text,
  status              text not null default 'pending'
                      check (status in ('pending','verifying','approved','rejected')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         uuid,
  review_note         text,
  constraint hospital_registration_target_ck check (
    (hospital_id is not null and proposed_name is null)
    or (hospital_id is null and proposed_name is not null)
  ),
  constraint hospital_registration_website_ck check (
    website is null or website ~* '^https?://'
  ),
  constraint hospital_registration_name_ck check (
    length(trim(admin_name)) between 2 and 120
  ),
  constraint hospital_registration_email_ck check (
    position('@' in admin_email) > 1
  )
);

create index if not exists hospital_registration_status_idx
  on public.hospital_registration_requests (status, created_at desc);
create index if not exists hospital_registration_email_idx
  on public.hospital_registration_requests (lower(admin_email));
create unique index if not exists hospital_registration_pending_existing_idx
  on public.hospital_registration_requests (hospital_id, lower(admin_email))
  where hospital_id is not null and status in ('pending','verifying');
create unique index if not exists hospital_registration_pending_new_idx
  on public.hospital_registration_requests (lower(proposed_name), lower(coalesce(proposed_city, '')), lower(admin_email))
  where hospital_id is null and status in ('pending','verifying');

alter table public.hospital_registration_requests enable row level security;
revoke all on public.hospital_registration_requests from anon, authenticated;

comment on table public.hospital_registration_requests is
  'Hospital onboarding applications. Pending applications never confer a membership or portal permission.';

create or replace function public.submit_hospital_registration(
  p_hospital_id   uuid,
  p_proposed_name text,
  p_proposed_city text,
  p_address       text,
  p_website       text,
  p_admin_name    text,
  p_admin_email   text,
  p_admin_phone   text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_existing public.hospital_registration_requests;
  v_row public.hospital_registration_requests;
  v_name text := nullif(trim(p_proposed_name), '');
  v_city text := nullif(trim(p_proposed_city), '');
  v_address text := nullif(trim(p_address), '');
  v_website text := nullif(trim(p_website), '');
  v_email text := lower(trim(p_admin_email));
  v_admin text := trim(p_admin_name);
begin
  if (p_hospital_id is null) = (v_name is null) then
    raise exception using errcode = '22023', message = 'Choose an existing hospital or provide a new hospital name.';
  end if;
  if length(v_admin) < 2 or length(v_admin) > 120 then
    raise exception using errcode = '22023', message = 'Enter the administrator name.';
  end if;
  if position('@' in v_email) < 2 then
    raise exception using errcode = '22023', message = 'Enter a valid work email.';
  end if;
  if v_website is not null and v_website !~* '^https?://' then
    raise exception using errcode = '22023', message = 'Website must start with https:// or http://.';
  end if;

  select * into v_existing
    from public.hospital_registration_requests r
   where r.status in ('pending','verifying')
     and lower(r.admin_email) = v_email
     and (
       (p_hospital_id is not null and r.hospital_id = p_hospital_id)
       or (p_hospital_id is null and r.hospital_id is null
           and lower(r.proposed_name) = lower(v_name)
           and lower(coalesce(r.proposed_city, '')) = lower(coalesce(v_city, '')))
     )
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

  insert into public.hospital_registration_requests (
    hospital_id, proposed_name, proposed_city, address, website,
    admin_name, admin_email, admin_phone
  ) values (
    p_hospital_id, v_name, v_city, v_address, v_website,
    v_admin, v_email, nullif(trim(p_admin_phone), '')
  ) returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'duplicate', false,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.submit_hospital_registration(uuid,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_hospital_registration(uuid,text,text,text,text,text,text,text) to anon, authenticated;

insert into public.fc_schema_migrations(version) values ('0009_hospital_registration')
  on conflict (version) do nothing;
