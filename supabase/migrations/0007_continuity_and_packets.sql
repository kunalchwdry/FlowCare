-- ===========================================================================
-- 0007_continuity_and_packets.sql — dependent profiles, patient-reported
-- referral tracking, results-delivery facts, carry lists, offline visit packet
-- ===========================================================================
-- This migration REVISES a decision recorded in 0006's header. 0006 said F04
-- and F14/F16/F17 were "not implemented" because FlowCare has no consent
-- authority, referral system, document store or results system. That reasoning
-- conflated two different claims:
--
--     (a) "we cannot build the authoritative version of this"   — still true
--     (b) "we cannot build anything useful here"                — false
--
-- Each of these four features has an honest subset that does not require the
-- missing system, provided the record never claims an authority it lacks.
-- 0006 is applied and its checksum is in the ledger, so its header is left
-- untouched; this header supersedes it. See
-- docs/research/08-third-phase-gap-analysis.md §4 (revised).
--
--   F04 Dependent profile      -> dependent_profiles
--       NOT guardianship. A booking identity for someone who has no account.
--       It grants ZERO access to any other auth.users row. If the dependent
--       has an account, F03 delegation is the only path. There is no
--       'verified' relationship basis and no way to add one.
--
--   F14 Referral tracker       -> referral_trackers
--       Patient-reported only. CHECK pins source = 'patient_reported', so a
--       row can never be rendered as a hospital-issued referral.
--
--   F16 Share/carry packet     -> carry_items + public.visit_packet()
--       No file storage, no upload, no document vault — therefore none of the
--       retention/encryption/deletion governance that blocked it. A checklist
--       of what to bring plus an assembled offline packet of data the patient
--       already owns.
--
--   F17 Results delivery       -> hospital_results_policies + results_preferences
--       Split into a verifiable facility fact (how this place actually returns
--       results, with provenance; absent row => "not published") and a patient
--       preference (what they want to ask for). FlowCare never promises to
--       deliver a result and stores no result.
--
--   F20 Offline packet         -> public.visit_packet() serves the print view.
--
-- Additive and idempotent. No DROP TABLE, no DROP COLUMN.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. F04 — dependent profiles (explicitly NOT guardianship)
-- ---------------------------------------------------------------------------
-- The research's non-negotiable is "never infer legal guardianship". This
-- table cannot express guardianship at all:
--   * there is no auth.users reference for the dependent — a profile is a
--     label, not an account, so it can never be a key to someone's records;
--   * relationship_basis has exactly one legal value, 'self_declared';
--   * nothing reads this table to make an authorization decision. Grep for it:
--     it appears in no RLS policy predicate anywhere.
-- Its entire job is to stop people retyping a relative's details at booking
-- time, and to put the right name on the appointment the hospital sees.

create table if not exists public.dependent_profiles (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete restrict,
  display_name        text not null check (length(btrim(display_name)) between 1 and 80),
  relationship_label  text check (relationship_label is null
                                  or length(btrim(relationship_label)) between 1 and 40),
  relationship_basis  text not null default 'self_declared'
                      check (relationship_basis = 'self_declared'),
  contact_phone       text check (contact_phone is null
                                  or length(btrim(contact_phone)) between 4 and 40),
  note                text check (note is null or length(note) <= 500),
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  unique (owner_id, display_name)
);
create index if not exists dependent_profiles_owner_idx
  on public.dependent_profiles (owner_id, created_at desc);

comment on table public.dependent_profiles is
  'F04. A booking identity for a person who has no FlowCare account. This is NOT a guardianship record and grants no access to any other account: there is no auth.users reference, relationship_basis has only one permitted value (self_declared), and no RLS policy anywhere consults this table. To share data with someone who DOES have an account, use care_delegations (F03).';

-- Which profile an appointment was booked for. Additive, nullable; existing
-- rows and the existing booking path are unaffected. patient_name remains the
-- authoritative name on the appointment (this column can go null if the
-- profile is deleted, and the appointment must still stand on its own).
alter table public.appointments
  add column if not exists booked_for_profile_id uuid
    references public.dependent_profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. F14 — patient-reported referral tracking
-- ---------------------------------------------------------------------------
-- The research problem is loop closure: a patient is told "go and see a
-- cardiologist" and nothing tracks whether that ever happened. Solving it
-- authoritatively needs a referral system between clinicians, which does not
-- exist here. What DOES work without one is letting the patient record the
-- referral themselves and track its state.
--
-- The integrity requirement is that this can never be mistaken for a real
-- clinical referral, so `source` is pinned by CHECK to a single value.

create table if not exists public.referral_trackers (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete restrict,
  source             text not null default 'patient_reported'
                     check (source = 'patient_reported'),
  referred_by_label  text check (referred_by_label is null
                                 or length(btrim(referred_by_label)) between 1 and 120),
  to_hospital_id     uuid references public.hospitals(id) on delete set null,
  to_hospital_label  text check (to_hospital_label is null
                                 or length(btrim(to_hospital_label)) between 1 and 120),
  to_department_label text check (to_department_label is null
                                 or length(btrim(to_department_label)) between 1 and 80),
  -- A short free-text reminder in the patient's own words. Never parsed, never
  -- classified, never sent to a model, never used as an analytics dimension.
  note               text check (note is null or length(note) <= 400),
  status             text not null default 'open'
                     check (status in ('open','appointment_made','completed','abandoned')),
  referred_on        date,
  appointment_id     uuid references public.appointments(id) on delete set null,
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default clock_timestamp(),
  closed_at          timestamptz,
  -- a destination must be identifiable somehow, or the row tracks nothing
  constraint referral_has_destination
    check (to_hospital_id is not null
           or to_hospital_label is not null
           or to_department_label is not null),
  constraint referral_closed_consistency
    check ((status in ('completed','abandoned')) = (closed_at is not null))
);
create index if not exists referral_trackers_owner_idx
  on public.referral_trackers (owner_id, status, created_at desc);

comment on table public.referral_trackers is
  'F14. PATIENT-REPORTED referral tracking, never hospital-issued: the source column is pinned to patient_reported by CHECK. FlowCare does not receive, verify, transmit or act on referrals, and nothing here is clinical advice. The note column is the patient''s own words and is excluded from analytics and from every model prompt.';

-- ---------------------------------------------------------------------------
-- 3. F17 — results delivery: a facility fact and a patient preference
-- ---------------------------------------------------------------------------
-- Half a: how this department actually returns results. A verifiable fact
-- about the facility, carrying the same four provenance columns as every
-- other fact table (F18/F22). An absent row means "not published" — it must
-- never be rendered as "results are not available".

create table if not exists public.hospital_results_policies (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references public.hospitals(id) on delete cascade,
  department_id     uuid references public.departments(id) on delete cascade,
  method            text not null
                    check (method in ('collect_in_person','postal','email',
                                      'hospital_portal','phone','sms','unknown')),
  typical_wait_note text check (typical_wait_note is null
                                or length(btrim(typical_wait_note)) between 1 and 200),
  id_required_note  text check (id_required_note is null
                                or length(btrim(id_required_note)) between 1 and 200),
  source            text not null,
  source_url        text,
  verified_at       timestamptz,
  verified_by_role  text,
  constraint results_policy_source_ok check (private.fact_source_ok(source)),
  constraint results_policy_verifier_ok
    check ((verified_at is null) = (verified_by_role is null)),
  constraint results_policy_verifier_role_ok
    check (verified_by_role is null or private.verifier_role_ok(verified_by_role)),
  constraint results_policy_department_matches
    check (department_id is null or hospital_id is not null),
  unique (hospital_id, department_id, method)
);
create index if not exists results_policies_hospital_idx
  on public.hospital_results_policies (hospital_id);

comment on table public.hospital_results_policies is
  'F17 facility half. How a department returns results, as a provenance-bearing fact. An ABSENT row means "not published by this facility" and must be rendered as such — never as "no results service". FlowCare stores no result and delivers no result.';

-- Half b: what the patient would prefer to ask for. A stated preference only.
create table if not exists public.results_preferences (
  owner_id          uuid primary key references auth.users(id) on delete restrict,
  preferred_method  text not null
                    check (preferred_method in ('collect_in_person','postal','email',
                                                'hospital_portal','phone','sms')),
  accessibility_note text check (accessibility_note is null
                                 or length(btrim(accessibility_note)) between 1 and 300),
  updated_at        timestamptz not null default clock_timestamp()
);

comment on table public.results_preferences is
  'F17 patient half. A preference the patient can state to a hospital. FlowCare makes no promise that any facility honours it, and does not transmit it anywhere automatically.';

-- ---------------------------------------------------------------------------
-- 4. F16 — carry list (no document storage)
-- ---------------------------------------------------------------------------
-- The blocking objection to F16 was document governance: retention,
-- encryption at rest, deletion guarantees, keeping files away from models.
-- Every one of those follows from STORING FILES. A checklist of what to bring
-- stores no file and inherits none of it.

create table if not exists public.carry_items (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete restrict,
  label        text not null check (length(btrim(label)) between 1 and 120),
  -- where this item came from: a facility's published prep requirement, or
  -- the patient's own addition. Keeps facility-sourced advice distinguishable.
  origin       text not null default 'patient_added'
               check (origin in ('patient_added','facility_prep')),
  hospital_id  uuid references public.hospitals(id) on delete set null,
  packed       boolean not null default false,
  created_at   timestamptz not null default clock_timestamp(),
  unique (owner_id, label, hospital_id)
);
create index if not exists carry_items_owner_idx
  on public.carry_items (owner_id, packed, created_at desc);

comment on table public.carry_items is
  'F16 safe subset. A what-to-bring checklist. FlowCare stores NO patient documents: there is no file column, no upload path and no object-storage bucket behind this table, which is why it carries none of the document-vault governance requirements that deferred the full feature.';

-- ---------------------------------------------------------------------------
-- 5. Grants. ALTER DEFAULT PRIVILEGES grants new public tables to postgres and
--    service_role ONLY, so every table needs this explicitly or it is
--    invisible to the app.
-- ---------------------------------------------------------------------------
grant select on public.dependent_profiles        to authenticated;
grant select on public.referral_trackers         to authenticated;
grant select on public.results_preferences       to authenticated;
grant select on public.carry_items               to authenticated;
grant select on public.hospital_results_policies to anon, authenticated;

alter table public.dependent_profiles        enable row level security;
alter table public.referral_trackers         enable row level security;
alter table public.results_preferences       enable row level security;
alter table public.carry_items               enable row level security;
alter table public.hospital_results_policies enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Policies.
-- ---------------------------------------------------------------------------
-- All four patient-owned tables here are OWNER-ONLY. They are deliberately
-- not added to the F03 delegation scope allowlist: a caregiver helping with
-- logistics has no reason to read a dependent's details, a referral note or a
-- results preference, and the scope allowlist stays at three read scopes.

do $$ begin
  create policy dependent_profiles_owner on public.dependent_profiles
    for select to authenticated
    using (auth.uid() is not null and owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy referral_trackers_owner on public.referral_trackers
    for select to authenticated
    using (auth.uid() is not null and owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy results_preferences_owner on public.results_preferences
    for select to authenticated
    using (auth.uid() is not null and owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy carry_items_owner on public.carry_items
    for select to authenticated
    using (auth.uid() is not null and owner_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Facility facts follow the published-hospital rule used by every other fact
-- table: visible exactly when the hospital is visible.
do $$ begin
  create policy results_policies_public on public.hospital_results_policies
    for select to anon, authenticated
    using (exists (select 1 from public.hospitals h
                    where h.id = hospital_id and h.published));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 7. F04 write path
-- ---------------------------------------------------------------------------
create or replace function private.upsert_dependent_profile(
  p_id uuid, p_name text, p_relationship text, p_phone text, p_note text)
returns public.dependent_profiles
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.dependent_profiles;
  v_count int;
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'INVALID_INPUT: a name is required' using errcode = 'P0001';
  end if;

  if p_id is null then
    select count(*) into v_count
      from public.dependent_profiles where owner_id = v_actor;
    if v_count >= 10 then
      raise exception 'LIMIT_REACHED: at most 10 dependent profiles'
        using errcode = 'P0001';
    end if;

    insert into public.dependent_profiles
      (owner_id, display_name, relationship_label, contact_phone, note)
    values (v_actor, btrim(p_name), nullif(btrim(coalesce(p_relationship,'')),''),
            nullif(btrim(coalesce(p_phone,'')),''), nullif(btrim(coalesce(p_note,'')),''))
    returning * into v_row;
  else
    update public.dependent_profiles set
      display_name       = btrim(p_name),
      relationship_label = nullif(btrim(coalesce(p_relationship,'')),''),
      contact_phone      = nullif(btrim(coalesce(p_phone,'')),''),
      note               = nullif(btrim(coalesce(p_note,'')),''),
      updated_at         = clock_timestamp()
    where id = p_id and owner_id = v_actor
    returning * into v_row;

    if not found then
      raise exception 'NOT_FOUND: no such profile' using errcode = 'P0001';
    end if;
  end if;

  return v_row;
end $$;

create or replace function public.upsert_dependent_profile(
  p_id uuid default null, p_name text default null,
  p_relationship text default null, p_phone text default null,
  p_note text default null)
returns public.dependent_profiles language sql set search_path to ''
as $$ select private.upsert_dependent_profile(p_id, p_name, p_relationship, p_phone, p_note) $$;

create or replace function private.delete_dependent_profile(p_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := private.actor();
begin
  delete from public.dependent_profiles where id = p_id and owner_id = v_actor;
  if not found then
    raise exception 'NOT_FOUND: no such profile' using errcode = 'P0001';
  end if;
  return true;
end $$;

create or replace function public.delete_dependent_profile(p_id uuid)
returns boolean language sql set search_path to ''
as $$ select private.delete_dependent_profile(p_id) $$;

-- Attach a profile to an appointment the caller owns. Kept OUT of
-- private.mutate_appointment() on purpose: that function is the core booking
-- state machine and this migration does not reopen it.
create or replace function private.attach_dependent_profile(
  p_appointment uuid, p_profile uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_name  text;
  v_status text;
begin
  select a.status into v_status
    from public.appointments a
   where a.id = p_appointment and a.patient_id = v_actor;
  if v_status is null then
    raise exception 'NOT_FOUND: no such appointment' using errcode = 'P0001';
  end if;
  if v_status in ('completed','cancelled','no_show') then
    raise exception 'INVALID_TRANSITION: appointment is already %', v_status
      using errcode = 'P0001';
  end if;

  if p_profile is null then
    update public.appointments set booked_for_profile_id = null
      where id = p_appointment;
    return jsonb_build_object('appointmentId', p_appointment, 'profileId', null);
  end if;

  select display_name into v_name from public.dependent_profiles
    where id = p_profile and owner_id = v_actor;
  if v_name is null then
    raise exception 'NOT_FOUND: no such profile' using errcode = 'P0001';
  end if;

  -- copy the name onto the appointment so the record stands alone even if the
  -- profile is later deleted
  update public.appointments
     set booked_for_profile_id = p_profile, patient_name = v_name
   where id = p_appointment;

  return jsonb_build_object('appointmentId', p_appointment,
                            'profileId', p_profile, 'patientName', v_name);
end $$;

create or replace function public.attach_dependent_profile(
  p_appointment uuid, p_profile uuid default null)
returns jsonb language sql set search_path to ''
as $$ select private.attach_dependent_profile(p_appointment, p_profile) $$;

-- ---------------------------------------------------------------------------
-- 8. F14 write path
-- ---------------------------------------------------------------------------
create or replace function private.upsert_referral(
  p_id uuid, p_by text, p_hospital uuid, p_hospital_label text,
  p_department text, p_note text, p_status text, p_referred_on date)
returns public.referral_trackers
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.referral_trackers;
  v_status text := coalesce(nullif(btrim(coalesce(p_status,'')),''), 'open');
  v_closed timestamptz;
  v_count int;
begin
  if v_status not in ('open','appointment_made','completed','abandoned') then
    raise exception 'INVALID_INPUT: unknown status %', v_status using errcode = 'P0001';
  end if;
  if p_hospital is null and p_hospital_label is null and p_department is null then
    raise exception 'INVALID_INPUT: a destination is required' using errcode = 'P0001';
  end if;
  if p_hospital is not null
     and not exists (select 1 from public.hospitals h where h.id = p_hospital) then
    raise exception 'NOT_FOUND: no such hospital' using errcode = 'P0001';
  end if;

  v_closed := case when v_status in ('completed','abandoned')
                   then clock_timestamp() else null end;

  if p_id is null then
    select count(*) into v_count from public.referral_trackers
      where owner_id = v_actor and status in ('open','appointment_made');
    if v_count >= 20 then
      raise exception 'LIMIT_REACHED: at most 20 open referrals' using errcode = 'P0001';
    end if;

    insert into public.referral_trackers
      (owner_id, referred_by_label, to_hospital_id, to_hospital_label,
       to_department_label, note, status, referred_on, closed_at)
    values (v_actor, nullif(btrim(coalesce(p_by,'')),''), p_hospital,
            nullif(btrim(coalesce(p_hospital_label,'')),''),
            nullif(btrim(coalesce(p_department,'')),''),
            nullif(btrim(coalesce(p_note,'')),''), v_status, p_referred_on, v_closed)
    returning * into v_row;
  else
    update public.referral_trackers set
      referred_by_label   = nullif(btrim(coalesce(p_by,'')),''),
      to_hospital_id      = p_hospital,
      to_hospital_label   = nullif(btrim(coalesce(p_hospital_label,'')),''),
      to_department_label = nullif(btrim(coalesce(p_department,'')),''),
      note                = nullif(btrim(coalesce(p_note,'')),''),
      status              = v_status,
      referred_on         = p_referred_on,
      closed_at           = v_closed,
      updated_at          = clock_timestamp()
    where id = p_id and owner_id = v_actor
    returning * into v_row;

    if not found then
      raise exception 'NOT_FOUND: no such referral' using errcode = 'P0001';
    end if;
  end if;

  return v_row;
end $$;

create or replace function public.upsert_referral(
  p_id uuid default null, p_by text default null, p_hospital uuid default null,
  p_hospital_label text default null, p_department text default null,
  p_note text default null, p_status text default 'open',
  p_referred_on date default null)
returns public.referral_trackers language sql set search_path to ''
as $$ select private.upsert_referral(p_id, p_by, p_hospital, p_hospital_label,
                                     p_department, p_note, p_status, p_referred_on) $$;

create or replace function private.delete_referral(p_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := private.actor();
begin
  delete from public.referral_trackers where id = p_id and owner_id = v_actor;
  if not found then
    raise exception 'NOT_FOUND: no such referral' using errcode = 'P0001';
  end if;
  return true;
end $$;

create or replace function public.delete_referral(p_id uuid)
returns boolean language sql set search_path to ''
as $$ select private.delete_referral(p_id) $$;

-- ---------------------------------------------------------------------------
-- 9. F17 patient preference write path
-- ---------------------------------------------------------------------------
create or replace function private.set_results_preference(p_method text, p_note text)
returns public.results_preferences
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.results_preferences;
begin
  if p_method not in ('collect_in_person','postal','email','hospital_portal','phone','sms') then
    raise exception 'INVALID_INPUT: unknown delivery method' using errcode = 'P0001';
  end if;

  insert into public.results_preferences (owner_id, preferred_method, accessibility_note)
  values (v_actor, p_method, nullif(btrim(coalesce(p_note,'')),''))
  on conflict (owner_id) do update set
    preferred_method   = excluded.preferred_method,
    accessibility_note = excluded.accessibility_note,
    updated_at         = clock_timestamp()
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.set_results_preference(
  p_method text, p_note text default null)
returns public.results_preferences language sql set search_path to ''
as $$ select private.set_results_preference(p_method, p_note) $$;

-- ---------------------------------------------------------------------------
-- 10. F16 carry list write path
-- ---------------------------------------------------------------------------
create or replace function private.set_carry_item(
  p_id uuid, p_label text, p_hospital uuid, p_packed boolean, p_remove boolean)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.carry_items;
  v_count int;
begin
  if coalesce(p_remove, false) then
    delete from public.carry_items where id = p_id and owner_id = v_actor;
    if not found then
      raise exception 'NOT_FOUND: no such item' using errcode = 'P0001';
    end if;
    return jsonb_build_object('removed', true, 'id', p_id);
  end if;

  if p_id is not null then
    update public.carry_items
       set packed = coalesce(p_packed, packed),
           label  = coalesce(nullif(btrim(coalesce(p_label,'')),''), label)
     where id = p_id and owner_id = v_actor
    returning * into v_row;
    if not found then
      raise exception 'NOT_FOUND: no such item' using errcode = 'P0001';
    end if;
  else
    if p_label is null or length(btrim(p_label)) = 0 then
      raise exception 'INVALID_INPUT: a label is required' using errcode = 'P0001';
    end if;
    select count(*) into v_count from public.carry_items where owner_id = v_actor;
    if v_count >= 60 then
      raise exception 'LIMIT_REACHED: at most 60 carry items' using errcode = 'P0001';
    end if;

    insert into public.carry_items (owner_id, label, hospital_id, packed, origin)
    values (v_actor, btrim(p_label), p_hospital, coalesce(p_packed, false), 'patient_added')
    on conflict (owner_id, label, hospital_id) do update set
      packed = coalesce(excluded.packed, public.carry_items.packed)
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end $$;

create or replace function public.set_carry_item(
  p_id uuid default null, p_label text default null, p_hospital uuid default null,
  p_packed boolean default null, p_remove boolean default false)
returns jsonb language sql set search_path to ''
as $$ select private.set_carry_item(p_id, p_label, p_hospital, p_packed, p_remove) $$;

-- Seed the carry list from a facility's PUBLISHED prep requirements. The
-- patient chooses to do this; nothing is auto-inserted. Items land with
-- origin='facility_prep' so the UI can show where the advice came from.
create or replace function private.import_facility_carry_items(p_hospital uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_added int := 0;
begin
  if not exists (select 1 from public.hospitals h
                  where h.id = p_hospital and h.published) then
    raise exception 'NOT_FOUND: no such hospital' using errcode = 'P0001';
  end if;

  with src as (
    select distinct btrim(p.detail) as label
      from public.hospital_prep_requirements p
     where p.hospital_id = p_hospital
       and p.detail is not null
       and length(btrim(p.detail)) between 1 and 120
  ), ins as (
    insert into public.carry_items (owner_id, label, hospital_id, origin)
    select v_actor, src.label, p_hospital, 'facility_prep' from src
    on conflict (owner_id, label, hospital_id) do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  return jsonb_build_object('hospitalId', p_hospital, 'added', v_added);
end $$;

create or replace function public.import_facility_carry_items(p_hospital uuid)
returns jsonb language sql set search_path to ''
as $$ select private.import_facility_carry_items(p_hospital) $$;

-- ---------------------------------------------------------------------------
-- 11. F16 + F20 — the offline visit packet
-- ---------------------------------------------------------------------------
-- Assembled at read time from data that already exists. It stores nothing new,
-- invents nothing, and inherits its authorization from the same predicate the
-- appointment itself uses — so a caregiver with logistics:read can fetch it
-- and a stranger gets NOT_FOUND.
--
-- Every fact block carries its own provenance, and a block whose underlying
-- row is missing comes back as null rather than as a plausible default. The
-- print view must render null as "not published by this hospital".

create or replace function private.visit_packet(p_appointment uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_appt      record;
  v_arrival   jsonb;
  v_support   jsonb;
  v_results   jsonb;
  v_carry     jsonb;
  v_receipt   jsonb;
begin
  if not private.can_read_appointment(p_appointment) then
    raise exception 'NOT_FOUND: no such appointment' using errcode = 'P0001';
  end if;

  select a.id, a.status, a.patient_name, a.hospital_id, a.department_id,
         h.name as hospital_name, h.address, h.locality, h.city,
         h.phone as hospital_phone, h.timezone,
         d.name as department_name, s.starts_at, s.ends_at
    into v_appt
    from public.appointments a
    join public.hospitals h on h.id = a.hospital_id
    left join public.departments d on d.id = a.department_id
    left join public.slots s on s.id = a.slot_id
   where a.id = p_appointment;

  v_receipt := private.appointment_receipt(p_appointment);

  select to_jsonb(x) into v_arrival from (
    select ap.entrance_note, ap.registration_note, ap.opd_timing_note,
           ap.what_to_bring, ap.source, ap.source_url, ap.verified_at
      from public.hospital_arrival_packs ap
     where ap.hospital_id = v_appt.hospital_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_support from (
    select sc.purpose, sc.channel_type, sc.value, sc.hours_note,
           sc.source, sc.source_url, sc.verified_at
      from public.hospital_support_channels sc
     where sc.hospital_id = v_appt.hospital_id
     order by sc.purpose, sc.channel_type
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_results from (
    select rp.method, rp.typical_wait_note, rp.id_required_note,
           rp.source, rp.source_url, rp.verified_at
      from public.hospital_results_policies rp
     where rp.hospital_id = v_appt.hospital_id
       and (rp.department_id is null or rp.department_id = v_appt.department_id)
     order by rp.method
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_carry from (
    select ci.id, ci.label, ci.origin, ci.packed
      from public.carry_items ci
     where ci.owner_id = auth.uid()
       and (ci.hospital_id is null or ci.hospital_id = v_appt.hospital_id)
     order by ci.origin, ci.label
  ) x;

  return jsonb_build_object(
    'generatedAt',  clock_timestamp(),
    'appointment',  jsonb_build_object(
                      'id',             v_appt.id,
                      'status',         v_appt.status,
                      'patientName',    v_appt.patient_name,
                      'departmentName', v_appt.department_name,
                      'startsAt',       v_appt.starts_at,
                      'endsAt',         v_appt.ends_at,
                      'timezone',       v_appt.timezone),
    'receipt',      v_receipt,
    'hospital',     jsonb_build_object(
                      'id',       v_appt.hospital_id,
                      'name',     v_appt.hospital_name,
                      'address',  v_appt.address,
                      'locality', v_appt.locality,
                      'city',     v_appt.city,
                      'phone',    v_appt.hospital_phone),
    -- null, not {} — "this hospital has not published an arrival pack"
    'arrivalPack',    v_arrival,
    'supportChannels', v_support,
    'resultsPolicies', v_results,
    'carryList',       v_carry,
    'offlineSafe',     true,
    'notice', 'Prepared from FlowCare records and facility-published facts. '
              || 'Blank sections mean the hospital has not published that '
              || 'information, not that it does not exist. This is not a '
              || 'medical document.'
  );
end $$;

create or replace function public.visit_packet(p_appointment uuid)
returns jsonb language sql stable set search_path to ''
as $$ select private.visit_packet(p_appointment) $$;

-- ---------------------------------------------------------------------------
-- 12. Execute grants. Without these the functions exist but are unreachable.
-- ---------------------------------------------------------------------------
grant execute on function public.upsert_dependent_profile(uuid,text,text,text,text) to authenticated;
grant execute on function public.delete_dependent_profile(uuid)                     to authenticated;
grant execute on function public.attach_dependent_profile(uuid,uuid)                to authenticated;
grant execute on function public.upsert_referral(uuid,text,uuid,text,text,text,text,date) to authenticated;
grant execute on function public.delete_referral(uuid)                              to authenticated;
grant execute on function public.set_results_preference(text,text)                  to authenticated;
grant execute on function public.set_carry_item(uuid,text,uuid,boolean,boolean)     to authenticated;
grant execute on function public.import_facility_carry_items(uuid)                  to authenticated;
grant execute on function public.visit_packet(uuid)                                 to authenticated;

insert into public.fc_schema_migrations(version) values ('0007_continuity_and_packets')
  on conflict (version) do nothing;
