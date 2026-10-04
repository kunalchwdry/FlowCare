-- Keep the service-role claim while the system wrapper invokes the private
-- transition. private.actor() validates the subject, not the JWT role; leaving
-- the service role claim intact also makes repeated system transitions safe
-- within one transaction (and PostgREST requests are independently scoped).

create or replace function public.transition_care_request_system(
  p_id uuid, p_actor uuid, p_action text, p_option uuid default null, p_appointment uuid default null,
  p_reason text default null, p_metadata jsonb default '{}'::jsonb, p_expected_version integer default null
) returns public.care_requests language plpgsql security definer set search_path to '' as $$
declare
  v public.care_requests;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode='P0001', message='FORBIDDEN';
  end if;
  if p_action not in ('screen','offer_options','remind','open_follow_up') then
    raise exception using errcode='P0001', message='INVALID_INPUT';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('flowcare.system_transition', 'true', true);
  select * into v from private.transition_care_request(
    p_id, p_action, p_option, p_appointment, p_reason, p_metadata, p_expected_version
  );
  return v;
end $$;

insert into public.fc_schema_migrations(version) values ('0020_care_access_system_claim_scope') on conflict (version) do nothing;
