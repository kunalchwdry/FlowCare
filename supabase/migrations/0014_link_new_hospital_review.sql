-- ===========================================================================
-- 0014_link_new_hospital_review.sql — retain new listing on the request
-- ===========================================================================
-- The first review RPC created the new hospital and membership correctly, but
-- the request row did not retain the new hospital_id. The audit event had the
-- id, so repair that approved row and link future approvals automatically.
-- ===========================================================================

update public.hospital_registration_requests r
   set hospital_id = (e.metadata ->> 'hospital_id')::uuid,
       proposed_name = null,
       proposed_city = null,
       updated_at = clock_timestamp()
  from public.audit_events e
 where e.entity = 'hospital_registration_request'
   and e.action = 'hospital_registration.approved'
   and coalesce((e.metadata ->> 'new_hospital')::boolean, false) = true
   and e.entity_id = r.id::text
   and r.hospital_id is null
   and e.metadata ? 'hospital_id';

create or replace function private.link_new_hospital_review()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.entity = 'hospital_registration_request'
     and new.action = 'hospital_registration.approved'
     and coalesce((new.metadata ->> 'new_hospital')::boolean, false) = true
     and new.metadata ? 'hospital_id'
  then
    update public.hospital_registration_requests
       set hospital_id = (new.metadata ->> 'hospital_id')::uuid,
           proposed_name = null,
           proposed_city = null,
           updated_at = clock_timestamp()
     where id = new.entity_id::uuid
       and hospital_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists link_new_hospital_review on public.audit_events;
create trigger link_new_hospital_review
after insert on public.audit_events
for each row execute function private.link_new_hospital_review();

insert into public.fc_schema_migrations(version) values ('0014_link_new_hospital_review')
  on conflict (version) do nothing;
