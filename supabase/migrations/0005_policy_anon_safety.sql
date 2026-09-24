-- ===========================================================================
-- 0005_policy_anon_safety.sql — make permission checks safe inside RLS
-- ===========================================================================
-- Found by tests/rls.live.test.ts running against the real database. It would
-- not have shown up in any offline test, and `pglast` cannot see it either.
--
-- THE BUG
--   private.allowed() calls private.actor(), and private.actor() RAISES
--   'AUTH_REQUIRED' when there is no confirmed user. That is correct for an
--   RPC: an anonymous caller attempting a privileged write should be stopped
--   loudly.
--
--   It is wrong inside an RLS predicate. 0002's reviews_read policy read:
--
--     using ( (status='published' and private.hospital_public(hospital_id))
--             or author_id = auth.uid()
--             or private.allowed(hospital_id,'reviews:moderate') )
--
--   For an anonymous visitor, the first branch is false for any hidden or
--   removed review and the second is NULL, so Postgres evaluates the third —
--   which throws. The visitor does not get "no rows"; the entire SELECT fails
--   with AUTH_REQUIRED. One hidden review anywhere in the scanned set breaks
--   the public reviews list for every logged-out user.
--
--   Observed as: anon .from('hospital_reviews').eq('id', <hidden review>)
--   returning an error instead of [].
--
-- THE FIX
--   A quiet variant for use in policies. It returns false where allowed()
--   would raise, so an unauthenticated or unconfirmed reader simply sees
--   fewer rows — which is what an RLS predicate is supposed to express.
--   private.allowed() itself is untouched and all RPCs keep the loud version.
-- ===========================================================================

create or replace function private.allowed_quiet(p_hospital uuid, p_permission text)
returns boolean
language plpgsql stable security definer set search_path to ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return private.allowed(p_hospital, p_permission);
exception when others then
  -- Deleted, banned or email-unconfirmed actor: no rows, no error, no leak
  -- of whether the row existed.
  return false;
end $$;

comment on function private.allowed_quiet is
  'Row-level-security-safe form of private.allowed(). Returns false instead of raising AUTH_REQUIRED. Use this in USING clauses; use private.allowed()/require_permission() in RPCs, where a loud failure is correct.';

-- --- reviews ---------------------------------------------------------------
drop policy if exists reviews_read on public.hospital_reviews;
create policy reviews_read on public.hospital_reviews
  for select to anon, authenticated
  using (
    (status = 'published' and private.hospital_public(hospital_id))
    or (auth.uid() is not null and author_id = auth.uid())
    or private.allowed_quiet(hospital_id, 'reviews:moderate')
  );

-- --- reports ---------------------------------------------------------------
drop policy if exists reports_read on public.review_reports;
create policy reports_read on public.review_reports
  for select to authenticated
  using (
    (auth.uid() is not null and reporter_id = auth.uid())
    or exists (select 1 from public.hospital_reviews r
                where r.id = review_id
                  and private.allowed_quiet(r.hospital_id, 'reviews:moderate'))
  );

-- --- moderation events -----------------------------------------------------
drop policy if exists moderation_events_read on public.review_moderation_events;
create policy moderation_events_read on public.review_moderation_events
  for select to authenticated
  using (exists (select 1 from public.hospital_reviews r
                  where r.id = review_id
                    and private.allowed_quiet(r.hospital_id, 'reviews:moderate')));

-- --- corrections -----------------------------------------------------------
drop policy if exists corrections_read on public.facility_corrections;
create policy corrections_read on public.facility_corrections
  for select to authenticated
  using (
    (auth.uid() is not null and reporter_id = auth.uid())
    or private.allowed_quiet(hospital_id, 'corrections:review')
  );

-- --- discrepancies ---------------------------------------------------------
drop policy if exists discrepancies_read on public.field_discrepancies;
create policy discrepancies_read on public.field_discrepancies
  for select to authenticated
  using (private.allowed_quiet(hospital_id, 'facts:manage'));

insert into public.fc_schema_migrations(version) values ('0005_policy_anon_safety')
  on conflict (version) do nothing;
