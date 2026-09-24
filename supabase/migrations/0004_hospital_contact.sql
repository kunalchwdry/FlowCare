-- ===========================================================================
-- 0004_hospital_contact.sql — contact + operator facts on hospitals
-- ===========================================================================
-- Additive columns, each carrying its own provenance so the F18 freshness
-- rules apply to contact details the same way they apply to facts in the
-- dedicated fact tables. Phone has the shortest TTL of anything FlowCare
-- stores (90 days): a dead number at 9pm is the failure that strands someone.
-- ===========================================================================

alter table public.hospitals
  add column if not exists phone              text,
  add column if not exists website            text,
  add column if not exists email              text,
  add column if not exists operator           text,
  add column if not exists operator_type      text,
  add column if not exists contact_source     text,
  add column if not exists contact_checked_on date,
  -- Discovery-only hospitals are real places that are NOT wired into FlowCare
  -- booking. Availability for them is 'unknown' and must never be inferred
  -- from opening hours.
  add column if not exists booking_integrated boolean not null default false;

do $$ begin
  alter table public.hospitals add constraint hospitals_operator_type_ck
    check (operator_type is null or operator_type in
           ('public','government','private','ngo','business','unknown'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hospitals add constraint hospitals_contact_source_ck
    check (contact_source is null or contact_source in
           ('openstreetmap','hospital_published','flowcare_verified','public_registry'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hospitals add constraint hospitals_website_shape
    check (website is null or website ~* '^https?://');
exception when duplicate_object then null; end $$;

create index if not exists hospitals_operator_type_idx
  on public.hospitals (operator_type) where operator_type is not null;
create index if not exists hospitals_booking_idx
  on public.hospitals (booking_integrated) where booking_integrated;

comment on column public.hospitals.booking_integrated is
  'False for discovery-only records imported from a public dataset. Such a hospital has no departments, no slots and therefore availability "unknown" — which is reported as unknown, never inferred from opening hours.';
comment on column public.hospitals.contact_checked_on is
  'Date the contact block was last confirmed at source. NULL means unverified, and unverified is never rendered as fresh.';

insert into public.fc_schema_migrations(version) values ('0004_hospital_contact')
  on conflict (version) do nothing;
