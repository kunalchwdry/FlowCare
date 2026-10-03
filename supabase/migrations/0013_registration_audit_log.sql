-- ===========================================================================
-- 0013_registration_audit_log.sql — audit storage for hospital review
-- ===========================================================================
-- The live FlowCare core predates the generic audit_events table used by the
-- reviewer RPC. Add that append-only store before a reviewer can approve a
-- registration. The previous approval transaction rolled back safely when it
-- discovered the missing relation; no partial membership or hospital row was
-- created.
-- ===========================================================================

create table if not exists public.audit_events (
  id         bigserial primary key,
  actor_id   uuid,
  actor_role text not null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists audit_events_entity_idx
  on public.audit_events (entity, entity_id, created_at desc);

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;

comment on table public.audit_events is
  'Append-only FlowCare operations audit trail. Reviewer RPCs write through SECURITY DEFINER; ordinary users cannot read or write it.';

insert into public.fc_schema_migrations(version) values ('0013_registration_audit_log')
  on conflict (version) do nothing;
