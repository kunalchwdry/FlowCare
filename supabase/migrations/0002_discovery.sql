-- ===========================================================================
-- 0002_discovery.sql — hospital discovery, FlowCare reviews, moderation
-- ===========================================================================
-- Rewritten to match the REAL FlowCare architecture discovered in
-- docs/research/06-live-schema-audit.md. Differences from the first draft:
--   * extends public.hospitals additively instead of duplicating it
--   * reuses departments / slots / visits instead of creating parallel
--     hospital_departments / clinic_sessions tables
--   * text + CHECK instead of enum types (matches the core's style)
--   * explicit GRANT SELECT on every table (this project's ALTER DEFAULT
--     PRIVILEGES does NOT grant anon/authenticated)
--   * SELECT-only RLS; every write goes through a SECURITY DEFINER function
--     in `private`, wrapped by a thin `public.*` function
--   * authorization via private.allowed() + memberships, never a JWT role
--
-- Additive and idempotent. No DROP TABLE, no DROP COLUMN, no data loss.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend the permission allowlist (superset — no existing value invalidated)
-- ---------------------------------------------------------------------------
-- The discovery layer needs moderation and facility-data permissions. The core
-- allowlist is a CHECK constraint; replacing it with a strict superset keeps
-- every existing membership row valid.
do $$ begin
  if exists (select 1 from pg_constraint
             where conrelid='public.memberships'::regclass
               and conname='memberships_permissions_check') then
    alter table public.memberships drop constraint memberships_permissions_check;
  end if;
  alter table public.memberships add constraint memberships_permissions_check
    check (permissions <@ array[
      'appointments:read','appointments:manage',
      'queue:read','queue:manage',
      'memberships:manage',
      'reviews:moderate',      -- hide/remove FlowCare reviews, act on reports
      'facts:manage',          -- publish/verify facility facts (0003)
      'corrections:review'     -- triage patient-submitted corrections (0003)
    ]::text[]);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Discovery columns on the existing hospitals table
-- ---------------------------------------------------------------------------
alter table public.hospitals
  add column if not exists slug                 text,
  add column if not exists city                 text,
  add column if not exists locality             text,
  add column if not exists address              text,
  add column if not exists lat                  double precision,
  add column if not exists lng                  double precision,
  add column if not exists osm_type             text,
  add column if not exists osm_id               bigint,
  add column if not exists location_source      text,
  add column if not exists location_checked_on  date;

do $$ begin
  alter table public.hospitals add constraint hospitals_slug_format
    check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hospitals add constraint hospitals_latlng_range
    check ( (lat is null) = (lng is null)
            and (lat is null or (lat between -90 and 90 and lng between -180 and 180)) );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hospitals add constraint hospitals_osm_pair
    check ( (osm_type is null) = (osm_id is null)
            and (osm_type is null or osm_type in ('node','way','relation')) );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hospitals add constraint hospitals_location_source
    check (location_source is null or location_source in
           ('openstreetmap','hospital_published','flowcare_verified','public_registry'));
exception when duplicate_object then null; end $$;

create unique index if not exists hospitals_slug_key   on public.hospitals (slug) where slug is not null;
create unique index if not exists hospitals_osm_key    on public.hospitals (osm_type, osm_id) where osm_id is not null;
create        index if not exists hospitals_city_idx   on public.hospitals (lower(city)) where city is not null;
create        index if not exists hospitals_name_idx   on public.hospitals (lower(name));
create        index if not exists hospitals_geo_idx    on public.hospitals (lat, lng) where lat is not null;

comment on column public.hospitals.location_source is
  'Where lat/lng came from. Never "google": Google coordinates are cached separately in hospital_external_places under a 30-day expiry per Maps Service Terms 14.';

-- ---------------------------------------------------------------------------
-- 3. Google Places linkage — the ONLY Google-derived values we may persist
-- ---------------------------------------------------------------------------
create table if not exists public.hospital_external_places (
  hospital_id     uuid primary key references public.hospitals(id) on delete restrict,
  place_id        text not null,
  cached_lat      double precision,
  cached_lng      double precision,
  coords_cached_at timestamptz,
  place_id_refreshed_at timestamptz not null default clock_timestamp(),
  constraint external_places_coords_pair
    check ((cached_lat is null) = (cached_lng is null)
           and (cached_lat is null) = (coords_cached_at is null))
);

create unique index if not exists hospital_external_places_place_idx
  on public.hospital_external_places (place_id);

comment on table public.hospital_external_places is
  'Google Maps Service Terms 14: place IDs may be stored indefinitely (refresh >12 months), lat/lng may be cached at most 30 days, and NOTHING else may be warehoused. No display field (name, address, rating, hours, photo, review) is permitted in this table.';

create or replace function public.fc_expire_cached_place_coords()
returns integer
language sql
security definer
set search_path to ''
as $$
  with cleared as (
    update public.hospital_external_places
       set cached_lat = null, cached_lng = null, coords_cached_at = null
     where coords_cached_at is not null
       and coords_cached_at < now() - interval '30 days'
    returning 1
  ) select count(*)::int from cleared;
$$;

-- ---------------------------------------------------------------------------
-- 4. FlowCare reviews — only from a real, completed, own visit
-- ---------------------------------------------------------------------------
create table if not exists public.hospital_reviews (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references public.hospitals(id) on delete restrict,
  author_id      uuid not null references auth.users(id)       on delete restrict,
  visit_id       uuid not null references public.visits(id)    on delete restrict,
  overall        smallint not null check (overall     between 1 and 5),
  waiting        smallint          check (waiting     between 1 and 5),
  staff          smallint          check (staff       between 1 and 5),
  appointment    smallint          check (appointment between 1 and 5),
  facility       smallint          check (facility    between 1 and 5),
  body           text              check (body is null or length(btrim(body)) between 1 and 2000),
  status         text not null default 'published'
                 check (status in ('published','hidden','removed')),
  created_at     timestamptz not null default clock_timestamp(),
  updated_at     timestamptz not null default clock_timestamp(),
  version        integer not null default 1 check (version > 0)
);

-- One review per completed visit, and one per author per hospital.
create unique index if not exists hospital_reviews_one_per_visit
  on public.hospital_reviews (visit_id);
create unique index if not exists hospital_reviews_one_per_author_hospital
  on public.hospital_reviews (author_id, hospital_id);
create index if not exists hospital_reviews_hospital_status_idx
  on public.hospital_reviews (hospital_id, status, created_at desc);
create index if not exists hospital_reviews_author_idx
  on public.hospital_reviews (author_id, created_at desc);

comment on table public.hospital_reviews is
  'FlowCare''s own ratings. Structurally impossible to write without a completed visit: visit_id is NOT NULL and FK-bound to public.visits, and private.submit_review verifies the visit is the author''s own and in state=completed. Kept strictly separate from any Google rating, which is never stored.';

-- ---------------------------------------------------------------------------
-- 5. Saved hospitals
-- ---------------------------------------------------------------------------
create table if not exists public.hospital_favorites (
  user_id     uuid not null references auth.users(id)       on delete restrict,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  created_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, hospital_id)
);
create index if not exists hospital_favorites_user_idx
  on public.hospital_favorites (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Reports + moderation audit
-- ---------------------------------------------------------------------------
create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.hospital_reviews(id) on delete restrict,
  reporter_id uuid not null references auth.users(id)              on delete restrict,
  reason      text not null check (reason in ('spam','abuse','off_topic','personal_data','not_a_patient','other')),
  note        text check (note is null or length(btrim(note)) between 1 and 1000),
  status      text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at  timestamptz not null default clock_timestamp()
);
create unique index if not exists review_reports_one_per_reporter
  on public.review_reports (review_id, reporter_id);
create index if not exists review_reports_status_idx
  on public.review_reports (status, created_at desc);

create table if not exists public.review_moderation_events (
  id          bigint generated always as identity primary key,
  review_id   uuid not null references public.hospital_reviews(id) on delete restrict,
  actor_id    uuid     references auth.users(id) on delete restrict,
  actor_kind  text not null check (actor_kind in ('human','ai_flag')),
  action      text not null check (action in ('flagged','hidden','removed','restored','dismissed')),
  reason      text not null check (length(btrim(reason)) between 1 and 500),
  confidence  numeric(4,3) check (confidence is null or confidence between 0 and 1),
  occurred_at timestamptz not null default clock_timestamp(),
  -- An AI may only ever raise a flag, and must state a reason and confidence.
  -- Hiding, removing, restoring and dismissing are human-only, and a human
  -- action must carry an accountable actor.
  constraint moderation_ai_cannot_finalise check (
    (actor_kind = 'ai_flag'  and action = 'flagged' and actor_id is null and confidence is not null)
    or
    (actor_kind = 'human'    and actor_id is not null and confidence is null)
  )
);
create index if not exists review_moderation_events_review_idx
  on public.review_moderation_events (review_id, occurred_at desc);

comment on constraint moderation_ai_cannot_finalise on public.review_moderation_events is
  'Enforces "AI may only flag -> reason -> confidence -> human review" at the database level, not merely in application code.';

-- ---------------------------------------------------------------------------
-- 7. Discovery analytics — allowlisted event names, no free-text query strings
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_events (
  id         bigint generated always as identity primary key,
  name       text not null check (name in (
               'search_performed','filter_applied','hospital_viewed','compare_opened',
               'favorite_added','favorite_removed','assistant_used','map_opened',
               'directions_opened','profile_tab_viewed')),
  session_id text check (session_id is null or length(session_id) between 8 and 64),
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists discovery_events_created_idx on public.discovery_events (created_at desc);

comment on table public.discovery_events is
  'Deliberately stores NO raw search text and no user id. Health-search terms leak sensitive inference (see docs/research/sources.md S68-S69), so only allowlisted event names plus non-identifying props are recorded.';

-- ---------------------------------------------------------------------------
-- 8. GRANTS — required. This project''s default privileges exclude anon/authenticated.
-- ---------------------------------------------------------------------------
grant select on public.hospital_external_places to anon, authenticated;
grant select on public.hospital_reviews          to anon, authenticated;
grant select on public.hospital_favorites        to authenticated;
grant select on public.review_reports            to authenticated;
grant select on public.review_moderation_events  to authenticated;
-- discovery_events: write-only telemetry. No read grant to anyone but service_role.
revoke all on public.discovery_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. RLS — SELECT only (the event trigger already enabled RLS on each table)
-- ---------------------------------------------------------------------------
alter table public.hospital_external_places enable row level security;
alter table public.hospital_reviews         enable row level security;
alter table public.hospital_favorites       enable row level security;
alter table public.review_reports           enable row level security;
alter table public.review_moderation_events enable row level security;
alter table public.discovery_events         enable row level security;

do $$ begin
  create policy external_places_public on public.hospital_external_places
    for select to anon, authenticated
    using (private.hospital_public(hospital_id));
exception when duplicate_object then null; end $$;

-- Published reviews for published hospitals are public. Authors always see
-- their own (including hidden ones, so moderation is not silent). Staff with
-- reviews:moderate see everything for their hospital.
do $$ begin
  create policy reviews_read on public.hospital_reviews
    for select to anon, authenticated
    using (
      (status = 'published' and private.hospital_public(hospital_id))
      or author_id = auth.uid()
      or private.allowed(hospital_id, 'reviews:moderate')
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy favorites_owner on public.hospital_favorites
    for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy reports_read on public.review_reports
    for select to authenticated
    using (
      reporter_id = auth.uid()
      or exists (select 1 from public.hospital_reviews r
                  where r.id = review_id
                    and private.allowed(r.hospital_id, 'reviews:moderate'))
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy moderation_events_read on public.review_moderation_events
    for select to authenticated
    using (exists (select 1 from public.hospital_reviews r
                    where r.id = review_id
                      and private.allowed(r.hospital_id, 'reviews:moderate')));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 10. Helper: is this actor eligible to review this hospital?
-- ---------------------------------------------------------------------------
create or replace function private.reviewable_visit(p_hospital uuid)
returns uuid
language sql stable security definer set search_path to ''
as $$
  select v.id
    from public.visits v
    join public.appointments a on a.id = v.appointment_id
   where a.patient_id  = private.actor()
     and a.hospital_id = p_hospital
     and v.state       = 'completed'
     and v.completed_at is not null
   order by v.completed_at desc
   limit 1;
$$;

comment on function private.reviewable_visit is
  'Returns the most recent completed visit this actor had at the hospital, or NULL. The single source of review eligibility.';

-- ---------------------------------------------------------------------------
-- 11. Write RPCs
-- ---------------------------------------------------------------------------
create or replace function private.submit_review(
  p_hospital uuid, p_overall int, p_waiting int, p_staff int,
  p_appointment int, p_facility int, p_body text
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); v_visit uuid; r public.hospital_reviews;
begin
  if p_hospital is null or p_overall is null or p_overall not between 1 and 5 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if coalesce(length(btrim(p_body)),1) > 2000 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not private.hospital_public(p_hospital) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;

  v_visit := private.reviewable_visit(p_hospital);
  if v_visit is null then
    raise exception using errcode='P0001', message='NO_ELIGIBLE_VISIT';
  end if;

  insert into public.hospital_reviews
    (hospital_id, author_id, visit_id, overall, waiting, staff, appointment, facility, body)
  values
    (p_hospital, actor, v_visit, p_overall, p_waiting, p_staff, p_appointment, p_facility,
     nullif(btrim(p_body), ''))
  on conflict (author_id, hospital_id) do update
     set overall=excluded.overall, waiting=excluded.waiting, staff=excluded.staff,
         appointment=excluded.appointment, facility=excluded.facility, body=excluded.body,
         updated_at=clock_timestamp(), version=hospital_reviews.version+1
   where hospital_reviews.status = 'published'
  returning * into r;

  if r.id is null then
    raise exception using errcode='P0001', message='REVIEW_NOT_EDITABLE';
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.submit_review(
  p_hospital uuid, p_overall int, p_waiting int default null, p_staff int default null,
  p_appointment int default null, p_facility int default null, p_body text default null
) returns jsonb language sql set search_path to ''
as $$ select private.submit_review(p_hospital,p_overall,p_waiting,p_staff,p_appointment,p_facility,p_body) $$;

create or replace function private.set_favorite(p_hospital uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor();
begin
  if p_hospital is null or p_on is null then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not private.hospital_public(p_hospital) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  if p_on then
    insert into public.hospital_favorites(user_id, hospital_id)
    values (actor, p_hospital) on conflict do nothing;
  else
    delete from public.hospital_favorites where user_id=actor and hospital_id=p_hospital;
  end if;
  return jsonb_build_object('hospitalId', p_hospital, 'saved', p_on);
end $$;

create or replace function public.set_favorite(p_hospital uuid, p_on boolean)
returns jsonb language sql set search_path to ''
as $$ select private.set_favorite(p_hospital, p_on) $$;

create or replace function private.report_review(p_review uuid, p_reason text, p_note text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); r public.review_reports;
begin
  if p_review is null or p_reason is null
     or p_reason not in ('spam','abuse','off_topic','personal_data','not_a_patient','other') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if not exists (select 1 from public.hospital_reviews hr
                  where hr.id=p_review and hr.status='published'
                    and private.hospital_public(hr.hospital_id)) then
    raise exception using errcode='P0001', message='NOT_FOUND';
  end if;
  insert into public.review_reports(review_id, reporter_id, reason, note)
  values (p_review, actor, p_reason, nullif(btrim(p_note),''))
  on conflict (review_id, reporter_id) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.review_reports where review_id=p_review and reporter_id=actor;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.report_review(p_review uuid, p_reason text, p_note text default null)
returns jsonb language sql set search_path to ''
as $$ select private.report_review(p_review, p_reason, p_note) $$;

create or replace function private.moderate_review(p_review uuid, p_action text, p_reason text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor uuid := private.actor(); r public.hospital_reviews; new_status text;
begin
  if p_review is null or p_action not in ('hide','remove','restore')
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  select * into r from public.hospital_reviews where id=p_review for update;
  if not found then raise exception using errcode='P0001', message='NOT_FOUND'; end if;
  perform private.require_permission(r.hospital_id, 'reviews:moderate');

  new_status := case p_action when 'hide' then 'hidden'
                              when 'remove' then 'removed'
                              else 'published' end;
  update public.hospital_reviews
     set status=new_status, updated_at=clock_timestamp(), version=version+1
   where id=p_review returning * into r;

  insert into public.review_moderation_events(review_id, actor_id, actor_kind, action, reason)
  values (p_review, actor, 'human',
          case p_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'restored' end,
          btrim(p_reason));

  update public.review_reports set status='actioned'
   where review_id=p_review and status='open' and p_action <> 'restore';

  return to_jsonb(r);
end $$;

create or replace function public.moderate_review(p_review uuid, p_action text, p_reason text)
returns jsonb language sql set search_path to ''
as $$ select private.moderate_review(p_review, p_action, p_reason) $$;

-- Telemetry. Deliberately callable by anon: discovery works logged-out.
create or replace function private.record_discovery_event(p_name text, p_session text, p_props jsonb)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  if p_name is null or p_name not in (
      'search_performed','filter_applied','hospital_viewed','compare_opened',
      'favorite_added','favorite_removed','assistant_used','map_opened',
      'directions_opened','profile_tab_viewed') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  if p_props is not null and length(p_props::text) > 2000 then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  insert into public.discovery_events(name, session_id, props)
  values (p_name, nullif(btrim(p_session),''), coalesce(p_props,'{}'::jsonb));
end $$;

create or replace function public.record_discovery_event(p_name text, p_session text default null, p_props jsonb default '{}'::jsonb)
returns void language sql set search_path to ''
as $$ select private.record_discovery_event(p_name, p_session, p_props) $$;

-- ---------------------------------------------------------------------------
-- 12. Function grants (default privileges cover only postgres/service_role)
-- ---------------------------------------------------------------------------
grant execute on function public.submit_review(uuid,int,int,int,int,int,text) to authenticated;
grant execute on function public.set_favorite(uuid,boolean)                   to authenticated;
grant execute on function public.report_review(uuid,text,text)                to authenticated;
grant execute on function public.moderate_review(uuid,text,text)              to authenticated;
grant execute on function public.record_discovery_event(text,text,jsonb)      to anon, authenticated;
grant execute on function public.fc_expire_cached_place_coords()              to service_role;

insert into public.fc_schema_migrations(version) values ('0002_discovery')
  on conflict (version) do nothing;
