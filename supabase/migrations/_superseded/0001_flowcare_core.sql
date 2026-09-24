-- =====================================================================
-- FlowCare core (Phase 1) — appointments, sessions, queue, audit.
--
-- This migration is ADDITIVE and idempotent. It creates the Phase 1
-- objects only if they are absent, so running it against an existing
-- FlowCare project does not drop, rename or rewrite anything.
-- No DROP statements appear anywhere in this file by design.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enumerated domains (created only when missing)
-- ---------------------------------------------------------------------
do $$ begin
  create type hospital_type as enum
    ('multispecialty', 'general', 'clinic', 'daycare', 'specialty_center', 'teaching', 'charitable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appointment_status as enum
    ('booked', 'checked_in', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('open', 'full', 'cancelled', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role as enum ('patient', 'staff', 'admin');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Hospitals and their structure
-- ---------------------------------------------------------------------
create table if not exists public.hospitals (
  id                 text primary key,
  slug               text not null unique,
  name               text not null,
  type               hospital_type not null default 'general',
  address_line       text not null,
  city               text not null,
  state              text not null,
  postal_code        text,
  latitude           double precision not null,
  longitude          double precision not null,
  phone              text,
  website            text,
  flowcare_verified  boolean not null default false,
  onboarded_at       timestamptz,
  accessibility      text[] not null default '{}',
  languages          text[] not null default '{}',
  operating_hours    jsonb  not null default '{}'::jsonb,
  emergency_services boolean not null default false,
  bed_count          integer,
  description        text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint hospitals_lat_range check (latitude between -90 and 90),
  constraint hospitals_lng_range check (longitude between -180 and 180)
);

create index if not exists hospitals_city_idx     on public.hospitals (lower(city));
create index if not exists hospitals_active_idx   on public.hospitals (active);
create index if not exists hospitals_name_trgm_ix on public.hospitals (lower(name));

create table if not exists public.hospital_departments (
  id          text primary key,
  hospital_id text not null references public.hospitals(id) on delete cascade,
  specialty   text not null,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (hospital_id, specialty)
);
create index if not exists hospital_departments_hospital_idx on public.hospital_departments (hospital_id);

create table if not exists public.hospital_services (
  id          text primary key,
  hospital_id text not null references public.hospitals(id) on delete cascade,
  slug        text not null,
  name        text not null,
  unique (hospital_id, slug)
);
create index if not exists hospital_services_hospital_idx on public.hospital_services (hospital_id);

-- ---------------------------------------------------------------------
-- Clinic sessions (the ONLY source of appointment availability)
-- ---------------------------------------------------------------------
create table if not exists public.clinic_sessions (
  id            text primary key,
  hospital_id   text not null references public.hospitals(id) on delete cascade,
  department_id text not null references public.hospital_departments(id) on delete cascade,
  session_date  date not null,
  start_time    text not null,
  end_time      text not null,
  capacity      integer not null check (capacity >= 0),
  booked        integer not null default 0 check (booked >= 0),
  status        session_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint clinic_sessions_booked_lte_capacity check (booked <= capacity)
);
create index if not exists clinic_sessions_hospital_date_idx on public.clinic_sessions (hospital_id, session_date);
create index if not exists clinic_sessions_department_idx    on public.clinic_sessions (department_id, session_date);

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id            text primary key,
  hospital_id   text not null references public.hospitals(id) on delete restrict,
  patient_id    uuid not null,
  department_id text not null references public.hospital_departments(id) on delete restrict,
  session_id    text references public.clinic_sessions(id) on delete set null,
  scheduled_for timestamptz not null,
  status        appointment_status not null default 'booked',
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint appointments_completed_consistency
    check (status <> 'completed' or completed_at is not null)
);
create index if not exists appointments_patient_idx  on public.appointments (patient_id, scheduled_for desc);
create index if not exists appointments_hospital_idx on public.appointments (hospital_id, scheduled_for desc);
create index if not exists appointments_eligibility_idx
  on public.appointments (patient_id, hospital_id, status, completed_at desc);

-- ---------------------------------------------------------------------
-- Queue snapshots (published by hospital staff; never inferred)
-- ---------------------------------------------------------------------
create table if not exists public.hospital_queue_snapshots (
  id                  bigserial primary key,
  hospital_id         text not null references public.hospitals(id) on delete cascade,
  published           boolean not null default false,
  waiting_count       integer,
  median_wait_minutes integer,
  observed_at         timestamptz not null default now()
);
create index if not exists hospital_queue_snapshots_latest_idx
  on public.hospital_queue_snapshots (hospital_id, observed_at desc);

-- ---------------------------------------------------------------------
-- Audit trail (append only)
-- ---------------------------------------------------------------------
create table if not exists public.audit_events (
  id         bigserial primary key,
  actor_id   uuid,
  actor_role app_role,
  action     text not null,
  entity     text not null,
  entity_id  text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_entity_idx on public.audit_events (entity, entity_id, created_at desc);

-- ---------------------------------------------------------------------
-- Helper: current caller's role, read from the JWT app_metadata.
-- SECURITY DEFINER is deliberately NOT used: the claim is read from the
-- request JWT, which the client cannot forge.
-- ---------------------------------------------------------------------
create or replace function public.fc_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'role',
    'patient'
  );
$$;

create or replace function public.fc_is_admin()
returns boolean
language sql
stable
as $$ select public.fc_role() = 'admin'; $$;

create or replace function public.fc_staff_hospital()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
    -> 'app_metadata' ->> 'hospital_id';
$$;

-- ---------------------------------------------------------------------
-- RLS — directory data is public to read, operational data is scoped.
-- ---------------------------------------------------------------------
alter table public.hospitals               enable row level security;
alter table public.hospital_departments    enable row level security;
alter table public.hospital_services       enable row level security;
alter table public.clinic_sessions         enable row level security;
alter table public.appointments            enable row level security;
alter table public.hospital_queue_snapshots enable row level security;
alter table public.audit_events            enable row level security;

do $$ begin
  create policy hospitals_public_read on public.hospitals
    for select using (active = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy hospital_departments_public_read on public.hospital_departments
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy hospital_services_public_read on public.hospital_services
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy clinic_sessions_public_read on public.clinic_sessions
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy queue_public_read on public.hospital_queue_snapshots
    for select using (published = true);
exception when duplicate_object then null; end $$;

-- A patient sees only their own appointments. Staff see appointments at
-- their own hospital. Admins see everything.
do $$ begin
  create policy appointments_owner_read on public.appointments
    for select using (
      patient_id = auth.uid()
      or public.fc_is_admin()
      or (public.fc_role() = 'staff' and hospital_id = public.fc_staff_hospital())
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy appointments_owner_insert on public.appointments
    for insert with check (patient_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy appointments_owner_update on public.appointments
    for update using (
      patient_id = auth.uid()
      or public.fc_is_admin()
      or (public.fc_role() = 'staff' and hospital_id = public.fc_staff_hospital())
    );
exception when duplicate_object then null; end $$;

-- audit_events: no client-side read or write at all. The service-role
-- key bypasses RLS, and that is the only path that writes here.
do $$ begin
  create policy audit_events_admin_read on public.audit_events
    for select using (public.fc_is_admin());
exception when duplicate_object then null; end $$;
