-- ===========================================================================
-- 0008_user_keys_and_agent.sql — bring-your-own AI keys + agentic proposals
-- ===========================================================================
-- Two features, one migration, because the second is only safe given the
-- first:
--
--   1. user_ai_keys     A user supplies their OWN provider API key. FlowCare
--                       stores it ENCRYPTED and uses it on their behalf.
--   2. agent_proposals  The assistant can propose a real action (booking).
--                       A proposal is inert until the human confirms it.
--
-- ------------------------------------ THE RULE THIS MIGRATION EXISTS TO KEEP
-- The language model never writes to this database. Not once, not through a
-- tool, not with a validated argument list. The model's only reachable output
-- is a PROPOSAL row that does nothing until a human confirms it, and the
-- payload it confirms is built by the SERVER from validated search results —
-- not by the model. So a compromised, jailbroken or simply wrong model cannot
-- book, cancel, or alter anything. It can only suggest.
--
-- That is why confirm_agent_proposal() takes a proposal id and NOT a payload.
-- If it took a payload, prompt injection would be a booking primitive.
-- ---------------------------------------------------------------------------
--
-- KEY STORAGE THREAT MODEL
--   * A provider key is a bearer credential that costs its owner money.
--   * FlowCare stores only AES-256-GCM ciphertext. The 32-byte master key
--     lives in the server environment (FLOWCARE_KEY_ENCRYPTION_SECRET) and is
--     never written to the database, so a database dump alone yields nothing
--     usable.
--   * The plaintext is never returned to a browser, never logged, and never
--     placed in a model prompt.
--   * Only a masked hint ("sk-…4f2a") is ever displayed.
--   * There is no admin read path. No staff permission grants access. A
--     FlowCare operator cannot read a user's key.
--
-- Additive and idempotent. No DROP TABLE, no DROP COLUMN.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Encrypted provider keys
-- ---------------------------------------------------------------------------
create table if not exists public.user_ai_keys (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  provider          text not null
                    check (provider in ('gemini','openai','groq','nvidia',
                                        'openrouter','together','mistral')),
  -- base64( iv(12) || authTag(16) || ciphertext ). Opaque to Postgres; the
  -- database cannot decrypt this and is not meant to be able to.
  ciphertext        text not null check (length(ciphertext) between 16 and 8000),
  -- Display only. Last four characters of the original key, nothing more.
  key_hint          text not null check (key_hint ~ '^[A-Za-z0-9_-]{2,8}$'),
  label             text check (label is null or length(btrim(label)) between 1 and 60),
  model             text check (model is null or length(btrim(model)) between 1 and 80),
  -- 'unvalidated' until a real call to the provider has succeeded. The UI must
  -- not claim a key works before it has been exercised.
  status            text not null default 'unvalidated'
                    check (status in ('unvalidated','valid','invalid')),
  last_error        text check (last_error is null or length(last_error) <= 300),
  last_validated_at timestamptz,
  last_used_at      timestamptz,
  use_count         integer not null default 0 check (use_count >= 0),
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  unique (owner_id, provider)
);
create index if not exists user_ai_keys_owner_idx
  on public.user_ai_keys (owner_id, provider);

comment on table public.user_ai_keys is
  'Bring-your-own AI provider keys, AES-256-GCM encrypted. The decryption key is an environment variable on the server and is never stored here, so a dump of this table yields no usable credential. Plaintext is never returned to a browser, never logged, and never included in a model prompt. There is deliberately NO operator or staff read path.';

-- ---------------------------------------------------------------------------
-- 2. Agent proposals — the human-in-the-loop commit point
-- ---------------------------------------------------------------------------
-- payload is built by the SERVER from validated tool output. The model never
-- supplies it. Confirmation references the proposal id only.
create table if not exists public.agent_proposals (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('book_appointment','cancel_appointment')),
  -- everything the user is being asked to approve, in full, in plain terms
  payload       jsonb not null,
  -- a human-readable restatement shown on the confirmation card. Stored so
  -- that what the user approved is auditable after the fact.
  summary       text not null check (length(btrim(summary)) between 1 and 600),
  status        text not null default 'pending'
                check (status in ('pending','confirmed','cancelled','expired','failed')),
  -- short window: a stale proposal may reference a slot that is now full
  expires_at    timestamptz not null,
  result        jsonb,
  error_code    text check (error_code is null or length(error_code) <= 60),
  created_at    timestamptz not null default clock_timestamp(),
  decided_at    timestamptz,
  constraint proposal_future_expiry check (expires_at > created_at),
  constraint proposal_decided_consistency
    check ((status = 'pending') = (decided_at is null))
);
create index if not exists agent_proposals_owner_idx
  on public.agent_proposals (owner_id, status, created_at desc);

comment on table public.agent_proposals is
  'A proposed action awaiting explicit human confirmation. Inert until confirmed. The payload is assembled by the server from validated search results, never by the language model, and confirm_agent_proposal() accepts an id rather than a payload — so prompt injection cannot become a booking primitive.';

-- ---------------------------------------------------------------------------
-- 3. Grants. Note user_ai_keys.ciphertext IS selectable by its owner. That is
--    deliberate and safe: it is AES-GCM ciphertext whose master key is not in
--    this database, and the owner is the person who typed the key in. The
--    server reads it through this same path because FlowCare has no
--    service-role key.
-- ---------------------------------------------------------------------------
grant select on public.user_ai_keys   to authenticated;
grant select on public.agent_proposals to authenticated;

alter table public.user_ai_keys   enable row level security;
alter table public.agent_proposals enable row level security;

do $$ begin
  create policy user_ai_keys_owner on public.user_ai_keys
    for select to authenticated
    using (auth.uid() is not null and owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy agent_proposals_owner on public.agent_proposals
    for select to authenticated
    using (auth.uid() is not null and owner_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4. Key write path
-- ---------------------------------------------------------------------------
create or replace function private.save_ai_key(
  p_provider text, p_ciphertext text, p_hint text, p_label text, p_model text)
returns public.user_ai_keys
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.user_ai_keys;
begin
  if p_provider not in ('gemini','openai','groq','nvidia','openrouter','together','mistral') then
    raise exception 'INVALID_INPUT: unknown provider' using errcode = 'P0001';
  end if;
  if p_ciphertext is null or length(p_ciphertext) < 16 then
    raise exception 'INVALID_INPUT: missing key material' using errcode = 'P0001';
  end if;
  if p_hint is null or p_hint !~ '^[A-Za-z0-9_-]{2,8}$' then
    raise exception 'INVALID_INPUT: bad key hint' using errcode = 'P0001';
  end if;

  insert into public.user_ai_keys
    (owner_id, provider, ciphertext, key_hint, label, model, status,
     last_validated_at, last_error)
  values (v_actor, p_provider, p_ciphertext, p_hint,
          nullif(btrim(coalesce(p_label,'')),''),
          nullif(btrim(coalesce(p_model,'')),''),
          'unvalidated', null, null)
  on conflict (owner_id, provider) do update set
    ciphertext        = excluded.ciphertext,
    key_hint          = excluded.key_hint,
    label             = excluded.label,
    model             = excluded.model,
    -- replacing the key invalidates any previous validation result
    status            = 'unvalidated',
    last_validated_at = null,
    last_error        = null,
    updated_at        = clock_timestamp()
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.save_ai_key(
  p_provider text, p_ciphertext text, p_hint text,
  p_label text default null, p_model text default null)
returns public.user_ai_keys language sql set search_path to ''
as $$ select private.save_ai_key(p_provider, p_ciphertext, p_hint, p_label, p_model) $$;

create or replace function private.delete_ai_key(p_provider text)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := private.actor();
begin
  delete from public.user_ai_keys where owner_id = v_actor and provider = p_provider;
  if not found then
    raise exception 'NOT_FOUND: no key stored for that provider' using errcode = 'P0001';
  end if;
  return true;
end $$;

create or replace function public.delete_ai_key(p_provider text)
returns boolean language sql set search_path to ''
as $$ select private.delete_ai_key(p_provider) $$;

-- Record the outcome of a REAL call to the provider. The UI may only show
-- "valid" after this has been set from an actual round trip.
create or replace function private.mark_ai_key(
  p_provider text, p_ok boolean, p_error text)
returns public.user_ai_keys
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.user_ai_keys;
begin
  update public.user_ai_keys set
    status            = case when p_ok then 'valid' else 'invalid' end,
    last_validated_at = clock_timestamp(),
    last_error        = case when p_ok then null
                             else left(coalesce(p_error,'validation failed'), 300) end,
    updated_at        = clock_timestamp()
  where owner_id = v_actor and provider = p_provider
  returning * into v_row;

  if not found then
    raise exception 'NOT_FOUND: no key stored for that provider' using errcode = 'P0001';
  end if;
  return v_row;
end $$;

create or replace function public.mark_ai_key(
  p_provider text, p_ok boolean, p_error text default null)
returns public.user_ai_keys language sql set search_path to ''
as $$ select private.mark_ai_key(p_provider, p_ok, p_error) $$;

create or replace function private.touch_ai_key(p_provider text)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := private.actor();
begin
  update public.user_ai_keys
     set last_used_at = clock_timestamp(), use_count = use_count + 1
   where owner_id = v_actor and provider = p_provider;
  return found;
end $$;

create or replace function public.touch_ai_key(p_provider text)
returns boolean language sql set search_path to ''
as $$ select private.touch_ai_key(p_provider) $$;

-- ---------------------------------------------------------------------------
-- 5. Agent proposal lifecycle
-- ---------------------------------------------------------------------------
create or replace function private.create_agent_proposal(
  p_kind text, p_payload jsonb, p_summary text, p_ttl_seconds int)
returns public.agent_proposals
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.agent_proposals;
  v_ttl   int := least(greatest(coalesce(p_ttl_seconds, 600), 60), 1800);
  v_open  int;
begin
  if p_kind not in ('book_appointment','cancel_appointment') then
    raise exception 'INVALID_INPUT: unknown proposal kind' using errcode = 'P0001';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_INPUT: payload must be an object' using errcode = 'P0001';
  end if;

  -- an agent that can spam proposals is an agent that can be used to spam a
  -- human into confirming one by accident
  select count(*) into v_open from public.agent_proposals
   where owner_id = v_actor and status = 'pending' and expires_at > clock_timestamp();
  if v_open >= 5 then
    raise exception 'LIMIT_REACHED: too many pending proposals' using errcode = 'P0001';
  end if;

  insert into public.agent_proposals (owner_id, kind, payload, summary, expires_at)
  values (v_actor, p_kind, p_payload, btrim(p_summary),
          clock_timestamp() + make_interval(secs => v_ttl))
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.create_agent_proposal(
  p_kind text, p_payload jsonb, p_summary text, p_ttl_seconds int default 600)
returns public.agent_proposals language sql set search_path to ''
as $$ select private.create_agent_proposal(p_kind, p_payload, p_summary, p_ttl_seconds) $$;

-- Confirm. Takes an ID, never a payload — see the header.
create or replace function private.confirm_agent_proposal(p_id uuid)
returns public.agent_proposals
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.agent_proposals;
begin
  select * into v_row from public.agent_proposals
   where id = p_id and owner_id = v_actor
   for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND: no such proposal' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'INVALID_TRANSITION: proposal is already %', v_row.status
      using errcode = 'P0001';
  end if;
  -- Expiry does NOT raise. A `raise` aborts the surrounding transaction and
  -- would roll back the very UPDATE that records the expiry, leaving the row
  -- 'pending' for ever. So we mark it and RETURN it; the caller is required
  -- to check that the returned status is 'confirmed' before acting.
  if v_row.expires_at <= clock_timestamp() then
    update public.agent_proposals
       set status = 'expired', decided_at = clock_timestamp()
     where id = p_id
    returning * into v_row;
    return v_row;
  end if;

  update public.agent_proposals
     set status = 'confirmed', decided_at = clock_timestamp()
   where id = p_id
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.confirm_agent_proposal(p_id uuid)
returns public.agent_proposals language sql set search_path to ''
as $$ select private.confirm_agent_proposal(p_id) $$;

create or replace function private.close_agent_proposal(
  p_id uuid, p_status text, p_result jsonb, p_error text)
returns public.agent_proposals
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.agent_proposals;
begin
  if p_status not in ('cancelled','failed') then
    raise exception 'INVALID_INPUT: bad terminal status' using errcode = 'P0001';
  end if;

  update public.agent_proposals
     set status     = p_status,
         result     = coalesce(p_result, result),
         error_code = left(coalesce(p_error, error_code), 60),
         decided_at = coalesce(decided_at, clock_timestamp())
   where id = p_id and owner_id = v_actor
  returning * into v_row;

  if not found then
    raise exception 'NOT_FOUND: no such proposal' using errcode = 'P0001';
  end if;
  return v_row;
end $$;

create or replace function public.close_agent_proposal(
  p_id uuid, p_status text default 'cancelled',
  p_result jsonb default null, p_error text default null)
returns public.agent_proposals language sql set search_path to ''
as $$ select private.close_agent_proposal(p_id, p_status, p_result, p_error) $$;

-- Attach the outcome of a confirmed proposal (e.g. the appointment id).
create or replace function private.record_agent_result(p_id uuid, p_result jsonb)
returns public.agent_proposals
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := private.actor();
  v_row   public.agent_proposals;
begin
  update public.agent_proposals set result = p_result
   where id = p_id and owner_id = v_actor and status = 'confirmed'
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND: no such confirmed proposal' using errcode = 'P0001';
  end if;
  return v_row;
end $$;

create or replace function public.record_agent_result(p_id uuid, p_result jsonb)
returns public.agent_proposals language sql set search_path to ''
as $$ select private.record_agent_result(p_id, p_result) $$;

-- ---------------------------------------------------------------------------
-- 6. Execute grants
-- ---------------------------------------------------------------------------
grant execute on function public.save_ai_key(text,text,text,text,text) to authenticated;
grant execute on function public.delete_ai_key(text)                   to authenticated;
grant execute on function public.mark_ai_key(text,boolean,text)        to authenticated;
grant execute on function public.touch_ai_key(text)                    to authenticated;
grant execute on function public.create_agent_proposal(text,jsonb,text,int) to authenticated;
grant execute on function public.confirm_agent_proposal(uuid)          to authenticated;
grant execute on function public.close_agent_proposal(uuid,text,jsonb,text) to authenticated;
grant execute on function public.record_agent_result(uuid,jsonb)       to authenticated;

insert into public.fc_schema_migrations(version) values ('0008_user_keys_and_agent')
  on conflict (version) do nothing;
