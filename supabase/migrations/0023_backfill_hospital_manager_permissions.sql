/*
  0023_backfill_hospital_manager_permissions.sql

  Migration 0021 added supply-side permissions, but existing hospital manager
  memberships were created before those permissions existed. The UI correctly
  identified them as managers while database SECURITY DEFINER operations
  correctly rejected the missing explicit permissions.

  Backfill existing managers and keep future manager memberships in sync.
*/

begin;

create or replace function private.sync_hospital_manager_permissions()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if 'memberships:manage' = any(coalesce(new.permissions, '{}'::text[])) then
    new.permissions := array(
      select distinct permission
        from unnest(
          coalesce(new.permissions, '{}'::text[])
          || array['structure:manage','slots:manage','exports:read']::text[]
        ) as p(permission)
       order by permission
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists sync_hospital_manager_permissions on public.memberships;
create trigger sync_hospital_manager_permissions
before insert or update of permissions on public.memberships
for each row execute function private.sync_hospital_manager_permissions();

update public.memberships
   set permissions = array(
     select distinct permission
       from unnest(
         coalesce(permissions, '{}'::text[])
         || array['structure:manage','slots:manage','exports:read']::text[]
       ) as p(permission)
      order by permission
   ),
       updated_at = clock_timestamp(),
       version = version + 1
 where status = 'active'
   and 'memberships:manage' = any(coalesce(permissions, '{}'::text[]));

insert into public.fc_schema_migrations(version) values ('0023_backfill_hospital_manager_permissions')
  on conflict (version) do nothing;

commit;
