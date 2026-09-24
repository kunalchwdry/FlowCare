-- ===========================================================================
-- 0001_core_baseline.sql  —  BASELINE ASSERTION, NOT A CREATION SCRIPT
-- ===========================================================================
-- The FlowCare Phase-1 core (hospitals, departments, slots, appointments,
-- visits, memberships and the two event logs, plus the `private` schema that
-- holds the authorization primitives) was built before this work started and
-- already exists in the target project.
--
-- An earlier version of this file tried to CREATE that core from a
-- reconstruction of the written spec. That was wrong in a way `create table
-- if not exists` actively hides: the guard skipped the pre-existing
-- `public.hospitals`, and the migration then died several statements later on
--     create index hospitals_city_idx on public.hospitals (lower(city))
--         ERROR 42703: column "city" does not exist
-- because the real table is (id, name, timezone, published). See
-- docs/research/06-live-schema-audit.md for the full diff.
--
-- This file therefore asserts the baseline instead of inventing it. It makes
-- no DDL changes of any kind. Against the real project it is a no-op that
-- documents what 0002 and 0003 are allowed to assume. Against an empty
-- project it fails loudly and tells you to restore the core first, which is
-- far better than silently building half a schema.
-- ===========================================================================

do $$
declare
  missing text[] := '{}';
  t text;
  f text;
begin
  -- ---- required core tables -------------------------------------------
  foreach t in array array[
    'hospitals','departments','slots','appointments','visits',
    'memberships','membership_events','appointment_events'
  ] loop
    if to_regclass('public.'||t) is null then
      missing := missing || ('table public.'||t);
    end if;
  end loop;

  -- ---- required authorization primitives -------------------------------
  foreach f in array array[
    'private.actor()',
    'private.allowed(uuid,text)',
    'private.require_permission(uuid,text)',
    'private.hospital_public(uuid)',
    'private.department_public(uuid)',
    'private.can_read_appointment(uuid)'
  ] loop
    begin
      perform f::regprocedure;
    exception when others then
      missing := missing || ('function '||f);
    end;
  end loop;

  if cardinality(missing) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'CORE_BASELINE_MISSING',
      detail  = 'Absent objects: '||array_to_string(missing, ', '),
      hint    = 'Migrations 0002/0003 extend the existing FlowCare core; they do not create it. Restore the Phase-1 core first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invariants 0002 and 0003 rely on. Recorded here so a future reader does not
-- have to re-derive them from pg_catalog the hard way.
--
--  1. Writes never happen through table grants. `anon` and `authenticated`
--     hold SELECT only. Every mutation goes through a `public.*` wrapper that
--     delegates to a SECURITY DEFINER function in `private` with
--     `SET search_path TO ''`.
--  2. Identity is `private.actor()`, which rejects deleted, anonymous, banned
--     and email-unconfirmed users with P0001 'AUTH_REQUIRED'.
--  3. Authorization is per-hospital `memberships.permissions`, checked by
--     `private.allowed()`. There is no global admin role and no JWT role
--     claim. The permission allowlist is
--       appointments:read, appointments:manage,
--       queue:read, queue:manage, memberships:manage
--  4. New tables in `public` get RLS enabled automatically by the event
--     trigger `ensure_rls` -> `public.rls_auto_enable()`.
--  5. ALTER DEFAULT PRIVILEGES in `public` grants to postgres and
--     service_role ONLY. A new table is invisible to anon/authenticated until
--     an explicit GRANT SELECT is issued, regardless of its RLS policies.
--     Every table added by 0002/0003 therefore carries an explicit grant.
--  6. Status-like columns are `text` with a CHECK constraint, not enum types.
--  7. Unauthorized reads raise 'NOT_FOUND', never 'FORBIDDEN', so that the
--     existence of a row is not leaked.
-- ---------------------------------------------------------------------------

-- Migration bookkeeping table (created here so 0002/0003 can record
-- themselves). Service-role only: this is operational metadata, not app data.
create table if not exists public.fc_schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default clock_timestamp(),
  checksum    text
);

revoke all on public.fc_schema_migrations from anon, authenticated;

do $$ begin
  execute 'alter table public.fc_schema_migrations enable row level security';
exception when others then null; end $$;

comment on table public.fc_schema_migrations is
  'Applied migration ledger. No RLS policy and no grant to anon/authenticated: unreadable except to service_role and the table owner, by design.';
