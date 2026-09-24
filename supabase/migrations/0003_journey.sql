-- ===========================================================================
-- 0003_journey.sql — facility facts with provenance (F18 spine), care
-- contexts, visit history, follow-ups, corrections, discrepancies
-- ===========================================================================
-- Rewritten against the real architecture (docs/research/06-live-schema-audit.md):
-- text + CHECK instead of 11 enum types, explicit GRANTs, SELECT-only RLS,
-- writes through SECURITY DEFINER functions in `private`, and per-hospital
-- membership permissions rather than a global admin role.
--
-- Additive and idempotent. No DROP TABLE, no DROP COLUMN, no data loss.
--
-- NAMING WARNING: public.visits (Phase-1 core) is the queue state machine for
-- an appointment. public.visit_records (below, F19) is the patient-owned,
-- 24-month-retention personal visit history. They are different things.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared provenance contract
-- ---------------------------------------------------------------------------
-- Every fact table carries the same four provenance COLUMNS (not a JSONB
-- blob), so "which facts have not been rechecked in a year" is an index scan.
--
--   source            where the claim came from
--   source_url        citation, where one exists
--   verified_at       NULL  => unverified, and unverified can never be fresh
--   verified_by_role  who checked; must be NULL exactly when verified_at is
--
-- 'google_live' is deliberately NOT an allowed source. Google content is
-- never persisted; it is fetched live and labelled at render time.
-- ---------------------------------------------------------------------------

create or replace function private.fact_source_ok(p text) returns boolean
language sql immutable set search_path to '' as $$
  select p in ('hospital_published','flowcare_verified','patient_reported',
               'public_registry','openstreetmap');
$$;

create or replace function private.verifier_role_ok(p text) returns boolean
language sql immutable set search_path to '' as $$
  select p in ('hospital_staff','flowcare_reviewer','volunteer_mapper');
$$;

-- ---------------------------------------------------------------------------
-- 2. Fact tables
-- ---------------------------------------------------------------------------

-- F2 — services, with an explicit verification state. Unverified services are
-- shown but are NOT filterable: we never offer a filter we cannot enforce.
create table if not exists public.hospital_service_verifications (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  service_slug text not null check (service_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label       text not null check (length(btrim(label)) between 1 and 120),
  verification text not null default 'unverified'
               check (verification in ('unverified','self_reported','flowcare_verified','withdrawn')),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint service_verif_provenance_pair
    check ((verified_at is null) = (verified_by_role is null)),
  -- unverified can never claim a verification timestamp
  constraint service_verif_unverified_has_no_date
    check (verification <> 'unverified' or verified_at is null),
  unique (hospital_id, service_slug)
);
create index if not exists idx_service_verifications_freshness
  on public.hospital_service_verifications (verified_at nulls first);
create index if not exists idx_service_verifications_slug
  on public.hospital_service_verifications (service_slug) where verification = 'flowcare_verified';

-- F4 — scheme empanelment. Note the allowed values: listed | unknown.
-- There is no 'not_listed'. Absence of evidence that a hospital is empanelled
-- is not evidence that it is not, and telling a patient otherwise could cost
-- them treatment they are entitled to.
create table if not exists public.hospital_scheme_listings (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  scheme_code text not null check (scheme_code in ('pmjay','mjpjay','cghs','esic')),
  listing     text not null default 'unknown' check (listing in ('listed','unknown')),
  note        text check (note is null or length(btrim(note)) <= 500),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint scheme_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  unique (hospital_id, scheme_code)
);
create index if not exists idx_scheme_listings_freshness
  on public.hospital_scheme_listings (verified_at nulls first);

-- F3 — published charges. Always a published-price claim, never a quote.
create table if not exists public.hospital_charges (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  charge_type text not null check (charge_type in ('opd_consultation','registration','day_care')),
  amount_inr  numeric(10,2) check (amount_inr is null or amount_inr >= 0),
  currency    text not null default 'INR' check (currency = 'INR'),
  note        text check (note is null or length(btrim(note)) <= 500),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint charges_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  unique (hospital_id, charge_type)
);
create index if not exists idx_charges_freshness on public.hospital_charges (verified_at nulls first);

comment on table public.hospital_charges is
  'A published tariff for one narrow item. NOT an estimate of what a visit will cost, and never presented as one.';

-- F7 — accessibility, component by component. Never scored, never totalled.
-- A ramp plus an inaccessible toilet is not "50% accessible"; it is a ramp and
-- an inaccessible toilet, and the wheelchair user needs to know which.
create table if not exists public.hospital_accessibility_components (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  component   text not null check (component in (
                'step_free_entrance','ramp_gradient','accessible_toilet','lift_access',
                'accessible_parking','wheelchair_available','tactile_guidance',
                'sign_language_support','height_adjustable_table','accessible_reception',
                'braille_signage')),
  status      text not null default 'not_assessed'
              check (status in ('present','absent','partial','not_assessed')),
  note        text check (note is null or length(btrim(note)) <= 500),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint access_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  -- An unverified component MUST read 'not_assessed'. Claiming a ramp exists
  -- on nobody's authority is exactly the failure mode that strands people.
  constraint access_unverified_is_not_assessed
    check (verified_at is not null or status = 'not_assessed'),
  unique (hospital_id, component)
);
create index if not exists idx_accessibility_freshness
  on public.hospital_accessibility_components (verified_at nulls first);
create index if not exists idx_accessibility_component
  on public.hospital_accessibility_components (component, status);

comment on table public.hospital_accessibility_components is
  'Per-component facts only. There is deliberately no aggregate accessibility score, grade or percentage anywhere in this schema.';

-- F5 — languages actually supported at the counter.
create table if not exists public.hospital_language_support (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  language_code text not null check (language_code ~ '^[a-z]{2,3}$'),
  support     text not null default 'unknown'
              check (support in ('staff_speak','interpreter_on_request','signage_only','unknown')),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint lang_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  unique (hospital_id, language_code)
);
create index if not exists idx_language_support_freshness
  on public.hospital_language_support (verified_at nulls first);

-- F8 — the arrival pack: what to do in the first ten minutes on site.
create table if not exists public.hospital_arrival_packs (
  hospital_id uuid primary key references public.hospitals(id) on delete restrict,
  entrance_note   text check (entrance_note   is null or length(btrim(entrance_note))   <= 1000),
  registration_note text check (registration_note is null or length(btrim(registration_note)) <= 1000),
  opd_timing_note text check (opd_timing_note is null or length(btrim(opd_timing_note)) <= 1000),
  what_to_bring   text[] not null default '{}',
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint arrival_provenance_pair check ((verified_at is null) = (verified_by_role is null))
);
create index if not exists idx_arrival_packs_freshness
  on public.hospital_arrival_packs (verified_at nulls first);

-- F10 — wayfinding, one ordered step at a time.
create table if not exists public.hospital_wayfinding_routes (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  from_point  text not null check (from_point in ('main_gate','parking','drop_off','reception')),
  to_point    text not null check (length(btrim(to_point)) between 1 and 120),
  steps       text[] not null check (cardinality(steps) between 1 and 12),
  step_free   boolean,
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint wayfinding_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  unique (hospital_id, from_point, to_point)
);
create index if not exists idx_wayfinding_hospital on public.hospital_wayfinding_routes (hospital_id);

-- F9 — preparation requirements. ADMINISTRATIVE ONLY.
create table if not exists public.hospital_prep_requirements (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  prep_code   text not null check (prep_code in (
                'photo_id','referral_letter','previous_reports','insurance_card',
                'scheme_card','appointment_slip','payment_method','attendant_required',
                'arrive_early')),
  detail      text check (detail is null or length(btrim(detail)) <= 500),
  source           text not null check (private.fact_source_ok(source)),
  source_url       text,
  verified_at      timestamptz,
  verified_by_role text check (private.verifier_role_ok(verified_by_role)),
  constraint prep_provenance_pair check ((verified_at is null) = (verified_by_role is null)),
  unique (hospital_id, prep_code)
);
create index if not exists idx_prep_hospital on public.hospital_prep_requirements (hospital_id);

comment on table public.hospital_prep_requirements is
  'Administrative preparation only (documents, payment, timing). prep_code is a closed allowlist precisely so that no clinical instruction — fasting, medication changes, test preparation — can ever be stored here. Application-side CLINICAL_BLOCKLIST guards the free-text detail column on both write paths.';

-- ---------------------------------------------------------------------------
-- 3. Patient-owned tables
-- ---------------------------------------------------------------------------
-- Note what is absent from all four: any staff or admin read policy. A
-- hospital administrator has no route to another person's saved care context
-- or visit history. That is the point.

-- F1/F12 — a saved "who I am looking for care for" context.
create table if not exists public.care_contexts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete restrict,
  label      text not null check (length(btrim(label)) between 1 and 80),
  need_codes text[] not null default '{}' check (cardinality(need_codes) <= 10),
  locality   text check (locality is null or length(btrim(locality)) <= 120),
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, label)
);
create index if not exists idx_care_contexts_owner on public.care_contexts (owner_id, created_at desc);

-- F19 — personal visit history, 24-month retention, enforced on every read.
create table if not exists public.visit_records (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete restrict,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  visited_on  date not null,
  department_label text check (department_label is null or length(btrim(department_label)) <= 120),
  note        text check (note is null or length(btrim(note)) <= 1000),
  created_at  timestamptz not null default clock_timestamp(),
  expires_on  date not null generated always as (visited_on + interval '24 months') stored,
  constraint visit_records_not_future check (visited_on <= current_date + 1)
);
create index if not exists idx_visit_records_owner on public.visit_records (owner_id, visited_on desc);
create index if not exists idx_visit_records_retention on public.visit_records (expires_on);

comment on column public.visit_records.expires_on is
  'Generated, not application-supplied. Reads filter on it and fc_purge_expired_visit_records() deletes past it, so retention holds even if the purge job stops running.';

-- F20 — follow-up tasks the patient set for themselves.
create table if not exists public.follow_up_tasks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete restrict,
  hospital_id uuid references public.hospitals(id) on delete restrict,
  kind        text not null check (kind in ('report_collection','review_visit','document_submission','revisit_reminder')),
  title       text not null check (length(btrim(title)) between 1 and 160),
  due_on      date,
  status      text not null default 'open' check (status in ('open','done','dismissed')),
  created_at  timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint followup_completed_pair check ((status = 'done') = (completed_at is not null))
);
create index if not exists idx_follow_up_owner on public.follow_up_tasks (owner_id, status, due_on);

-- ---------------------------------------------------------------------------
-- 4. F17 — patient-submitted corrections. Nothing self-publishes.
-- ---------------------------------------------------------------------------
create table if not exists public.facility_corrections (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references public.hospitals(id) on delete restrict,
  reporter_id  uuid not null references auth.users(id) on delete restrict,
  field        text not null check (field in (
                 'phone','address','locality','city','website',
                 'opd_timing','charge','scheme_listing','accessibility','service','prep')),
  current_value text check (current_value is null or length(current_value) <= 500),
  proposed_value text not null check (length(btrim(proposed_value)) between 1 and 500),
  comment      text check (comment is null or length(btrim(comment)) <= 1000),
  decision     text not null default 'pending'
               check (decision in ('pending','accepted','rejected','needs_evidence')),
  reviewer_id  uuid references auth.users(id) on delete restrict,
  reviewed_at  timestamptz,
  reviewer_note text check (reviewer_note is null or length(btrim(reviewer_note)) <= 1000),
  applied_at   timestamptz,
  created_at   timestamptz not null default clock_timestamp(),
  -- A decision other than 'pending' REQUIRES an accountable human reviewer and
  -- a timestamp. There is no path by which a submission publishes itself.
  constraint correction_decision_requires_reviewer check (
    (decision = 'pending' and reviewer_id is null and reviewed_at is null)
    or
    (decision <> 'pending' and reviewer_id is not null and reviewed_at is not null)
  ),
  constraint correction_applied_only_if_accepted check (
    applied_at is null or decision = 'accepted'
  )
);
create index if not exists idx_corrections_queue    on public.facility_corrections (decision, created_at);
create index if not exists idx_corrections_hospital on public.facility_corrections (hospital_id, created_at desc);
create index if not exists idx_corrections_reporter on public.facility_corrections (reporter_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. F16 — cross-source discrepancies. Fingerprints only, never values.
-- ---------------------------------------------------------------------------
create table if not exists public.field_discrepancies (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references public.hospitals(id) on delete restrict,
  field         text not null check (field in ('phone','address','hours')),
  flowcare_hash text not null check (flowcare_hash ~ '^[0-9a-f]{64}$'),
  external_hash text not null check (external_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at  timestamptz not null default clock_timestamp(),
  resolved_at   timestamptz,
  constraint discrepancy_differs check (flowcare_hash <> external_hash),
  unique (hospital_id, field, flowcare_hash, external_hash)
);
create index if not exists idx_discrepancies_open
  on public.field_discrepancies (hospital_id) where resolved_at is null;

comment on table public.field_discrepancies is
  'Stores salted SHA-256 fingerprints only — never the compared values, and never anything Google-derived in plaintext. The field allowlist (phone/address/hours) is a CHECK, so the comparison surface cannot widen by accident. Ships dark: requires FLOWCARE_DISCREPANCY_ENABLED and FLOWCARE_DISCREPANCY_SALT, pending the Maps Service Terms 14.3 question recorded in docs/research/03-review-and-plan.md.';

-- ---------------------------------------------------------------------------
-- 6. Retention job + freshness view
-- ---------------------------------------------------------------------------
create or replace function public.fc_purge_expired_visit_records()
returns integer
language sql security definer set search_path to ''
as $$
  with gone as (
    delete from public.visit_records where expires_on < current_date returning 1
  ) select count(*)::int from gone;
$$;

create or replace view public.fc_fact_freshness as
  select 'service'       as fact_type, hospital_id, verified_at from public.hospital_service_verifications
  union all select 'scheme',        hospital_id, verified_at from public.hospital_scheme_listings
  union all select 'charge',        hospital_id, verified_at from public.hospital_charges
  union all select 'accessibility', hospital_id, verified_at from public.hospital_accessibility_components
  union all select 'language',      hospital_id, verified_at from public.hospital_language_support
  union all select 'arrival',       hospital_id, verified_at from public.hospital_arrival_packs
  union all select 'wayfinding',    hospital_id, verified_at from public.hospital_wayfinding_routes
  union all select 'prep',          hospital_id, verified_at from public.hospital_prep_requirements;

-- ---------------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------------
grant select on public.hospital_service_verifications    to anon, authenticated;
grant select on public.hospital_scheme_listings          to anon, authenticated;
grant select on public.hospital_charges                  to anon, authenticated;
grant select on public.hospital_accessibility_components to anon, authenticated;
grant select on public.hospital_language_support         to anon, authenticated;
grant select on public.hospital_arrival_packs            to anon, authenticated;
grant select on public.hospital_wayfinding_routes        to anon, authenticated;
grant select on public.hospital_prep_requirements        to anon, authenticated;
grant select on public.fc_fact_freshness                 to anon, authenticated;

grant select on public.care_contexts        to authenticated;
grant select on public.visit_records        to authenticated;
grant select on public.follow_up_tasks      to authenticated;
grant select on public.facility_corrections to authenticated;
grant select on public.field_discrepancies  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
alter table public.hospital_service_verifications    enable row level security;
alter table public.hospital_scheme_listings          enable row level security;
alter table public.hospital_charges                  enable row level security;
alter table public.hospital_accessibility_components enable row level security;
alter table public.hospital_language_support         enable row level security;
alter table public.hospital_arrival_packs            enable row level security;
alter table public.hospital_wayfinding_routes        enable row level security;
alter table public.hospital_prep_requirements        enable row level security;
alter table public.care_contexts                     enable row level security;
alter table public.visit_records                     enable row level security;
alter table public.follow_up_tasks                   enable row level security;
alter table public.facility_corrections              enable row level security;
alter table public.field_discrepancies               enable row level security;

-- Facts are public for published hospitals.
do $$
declare t text;
begin
  foreach t in array array[
    'hospital_service_verifications','hospital_scheme_listings','hospital_charges',
    'hospital_accessibility_components','hospital_language_support',
    'hospital_arrival_packs','hospital_wayfinding_routes','hospital_prep_requirements'
  ] loop
    begin
      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (private.hospital_public(hospital_id))',
        t||'_public', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Patient-owned: owner only. No staff policy, no admin policy, by design.
do $$ begin
  create policy care_contexts_owner on public.care_contexts
    for select to authenticated using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy visit_records_owner on public.visit_records
    for select to authenticated
    using (owner_id = auth.uid() and expires_on >= current_date);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy follow_up_owner on public.follow_up_tasks
    for select to authenticated using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Corrections: the reporter sees their own; reviewers see their hospital's queue.
do $$ begin
  create policy corrections_read on public.facility_corrections
    for select to authenticated
    using (reporter_id = auth.uid() or private.allowed(hospital_id, 'corrections:review'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy discrepancies_read on public.field_discrepancies
    for select to authenticated
    using (private.allowed(hospital_id, 'facts:manage'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 9. Write RPCs
-- ---------------------------------------------------------------------------
create or replace function private.save_care_context(p_label text, p_needs text[], p_locality text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); c public.care_contexts;
begin
  if p_label is null or length(btrim(p_label)) not between 1 and 80
     or p_needs is null or cardinality(p_needs) > 10 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if (select count(*) from public.care_contexts where owner_id=actor) >= 20 then
    raise exception using errcode='P0001', message='LIMIT_REACHED';
  end if;
  insert into public.care_contexts(owner_id,label,need_codes,locality)
  values (actor, btrim(p_label), p_needs, nullif(btrim(p_locality),''))
  on conflict (owner_id,label) do update
     set need_codes=excluded.need_codes, locality=excluded.locality
  returning * into c;
  return to_jsonb(c);
end $$;

create or replace function public.save_care_context(p_label text, p_needs text[] default '{}', p_locality text default null)
returns jsonb language sql set search_path to ''
as $$ select private.save_care_context(p_label,p_needs,p_locality) $$;

create or replace function private.delete_care_context(p_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); n int;
begin
  delete from public.care_contexts where id=p_id and owner_id=actor;
  get diagnostics n = row_count;
  if n = 0 then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  return true;
end $$;

create or replace function public.delete_care_context(p_id uuid)
returns boolean language sql set search_path to ''
as $$ select private.delete_care_context(p_id) $$;

create or replace function private.add_visit_record(
  p_hospital uuid, p_visited_on date, p_department text, p_note text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); v public.visit_records;
begin
  if p_hospital is null or p_visited_on is null or p_visited_on > current_date + 1 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not private.hospital_public(p_hospital) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if p_visited_on < current_date - interval '24 months' then
    raise exception using errcode='P0001', message='OUTSIDE_RETENTION_WINDOW';
  end if;
  insert into public.visit_records(owner_id,hospital_id,visited_on,department_label,note)
  values (actor,p_hospital,p_visited_on,nullif(btrim(p_department),''),nullif(btrim(p_note),''))
  returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.add_visit_record(
  p_hospital uuid, p_visited_on date, p_department text default null, p_note text default null)
returns jsonb language sql set search_path to ''
as $$ select private.add_visit_record(p_hospital,p_visited_on,p_department,p_note) $$;

create or replace function private.delete_visit_record(p_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); n int;
begin
  delete from public.visit_records where id=p_id and owner_id=actor;
  get diagnostics n = row_count;
  if n = 0 then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  return true;
end $$;

create or replace function public.delete_visit_record(p_id uuid)
returns boolean language sql set search_path to ''
as $$ select private.delete_visit_record(p_id) $$;

create or replace function private.upsert_follow_up(
  p_id uuid, p_hospital uuid, p_kind text, p_title text, p_due date, p_status text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); t public.follow_up_tasks;
begin
  if p_kind is null or p_kind not in ('report_collection','review_visit','document_submission','revisit_reminder')
     or p_title is null or length(btrim(p_title)) not between 1 and 160
     or p_status is null or p_status not in ('open','done','dismissed') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if p_id is null then
    insert into public.follow_up_tasks(owner_id,hospital_id,kind,title,due_on,status,completed_at)
    values (actor,p_hospital,p_kind,btrim(p_title),p_due,p_status,
            case when p_status='done' then clock_timestamp() end)
    returning * into t;
  else
    update public.follow_up_tasks
       set hospital_id=p_hospital, kind=p_kind, title=btrim(p_title), due_on=p_due,
           status=p_status,
           completed_at = case when p_status='done' then coalesce(completed_at, clock_timestamp()) end
     where id=p_id and owner_id=actor
    returning * into t;
    if t.id is null then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  end if;
  return to_jsonb(t);
end $$;

create or replace function public.upsert_follow_up(
  p_id uuid, p_hospital uuid, p_kind text, p_title text,
  p_due date default null, p_status text default 'open')
returns jsonb language sql set search_path to ''
as $$ select private.upsert_follow_up(p_id,p_hospital,p_kind,p_title,p_due,p_status) $$;

create or replace function private.delete_follow_up(p_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); n int;
begin
  delete from public.follow_up_tasks where id=p_id and owner_id=actor;
  get diagnostics n = row_count;
  if n = 0 then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  return true;
end $$;

create or replace function public.delete_follow_up(p_id uuid)
returns boolean language sql set search_path to ''
as $$ select private.delete_follow_up(p_id) $$;

-- F17 submit: always lands as 'pending'. The DB CHECK makes any other
-- starting state impossible, so a bug here cannot publish anything.
create or replace function private.submit_correction(
  p_hospital uuid, p_field text, p_current text, p_proposed text, p_comment text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); c public.facility_corrections;
begin
  if p_hospital is null or p_field is null
     or p_field not in ('phone','address','locality','city','website','opd_timing',
                        'charge','scheme_listing','accessibility','service','prep')
     or p_proposed is null or length(btrim(p_proposed)) not between 1 and 500 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not private.hospital_public(p_hospital) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  -- daily submission cap, per person
  if (select count(*) from public.facility_corrections
       where reporter_id=actor and created_at >= current_date) >= 5 then
    raise exception using errcode='P0001', message='DAILY_LIMIT_REACHED';
  end if;
  insert into public.facility_corrections(hospital_id,reporter_id,field,current_value,proposed_value,comment)
  values (p_hospital,actor,p_field,nullif(btrim(p_current),''),btrim(p_proposed),nullif(btrim(p_comment),''))
  returning * into c;
  return to_jsonb(c);
end $$;

create or replace function public.submit_correction(
  p_hospital uuid, p_field text, p_proposed text,
  p_current text default null, p_comment text default null)
returns jsonb language sql set search_path to ''
as $$ select private.submit_correction(p_hospital,p_field,p_current,p_proposed,p_comment) $$;

-- F17 review: human reviewer required by CHECK; accepted corrections to the
-- five hospital-level scalar fields are applied here via explicit branches.
-- No dynamic column names, ever.
create or replace function private.review_correction(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); c public.facility_corrections;
begin
  if p_decision is null or p_decision not in ('accepted','rejected','needs_evidence') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  select * into c from public.facility_corrections where id=p_id for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  perform private.require_permission(c.hospital_id, 'corrections:review');
  if c.decision <> 'pending' then
    raise exception using errcode='P0001', message='ALREADY_REVIEWED';
  end if;
  if actor = c.reporter_id then
    raise exception using errcode='P0001', message='SELF_REVIEW_FORBIDDEN';
  end if;

  update public.facility_corrections
     set decision=p_decision, reviewer_id=actor, reviewed_at=clock_timestamp(),
         reviewer_note=nullif(btrim(p_note),'')
   where id=p_id returning * into c;

  if p_decision = 'accepted' then
    if c.field = 'phone' then
      -- phone lives in a fact table in a later phase; recorded, not applied
      null;
    elsif c.field = 'address' then
      update public.hospitals set address = c.proposed_value where id = c.hospital_id;
    elsif c.field = 'locality' then
      update public.hospitals set locality = c.proposed_value where id = c.hospital_id;
    elsif c.field = 'city' then
      update public.hospitals set city = c.proposed_value where id = c.hospital_id;
    end if;
    if c.field in ('address','locality','city') then
      update public.facility_corrections set applied_at = clock_timestamp() where id = p_id
        returning * into c;
    end if;
  end if;
  return to_jsonb(c);
end $$;

create or replace function public.review_correction(p_id uuid, p_decision text, p_note text default null)
returns jsonb language sql set search_path to ''
as $$ select private.review_correction(p_id,p_decision,p_note) $$;

-- ---------------------------------------------------------------------------
-- 10. Function grants
-- ---------------------------------------------------------------------------
grant execute on function public.save_care_context(text,text[],text)          to authenticated;
grant execute on function public.delete_care_context(uuid)                    to authenticated;
grant execute on function public.add_visit_record(uuid,date,text,text)        to authenticated;
grant execute on function public.delete_visit_record(uuid)                    to authenticated;
grant execute on function public.upsert_follow_up(uuid,uuid,text,text,date,text) to authenticated;
grant execute on function public.delete_follow_up(uuid)                       to authenticated;
grant execute on function public.submit_correction(uuid,text,text,text,text)  to authenticated;
grant execute on function public.review_correction(uuid,text,text)            to authenticated;
grant execute on function public.fc_purge_expired_visit_records()             to service_role;

insert into public.fc_schema_migrations(version) values ('0003_journey')
  on conflict (version) do nothing;
