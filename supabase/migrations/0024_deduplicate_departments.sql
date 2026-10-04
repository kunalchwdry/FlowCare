/*
  0024_deduplicate_departments.sql

  Hospital managers could submit the department form twice while the live
  operations adapter was being repaired. Keep the department record carrying
  the most operational data, move all slots/providers/services to it, remove
  the empty duplicate, and prevent the same hospital from creating another
  department with the same name.
*/

begin;

create temporary table _flowcare_department_merge on commit drop as
select duplicate_id, keep_id
from (
  select
    d.id as duplicate_id,
    first_value(d.id) over (
      partition by d.hospital_id, lower(btrim(d.name))
      order by (
        (select count(*) from public.slots s where s.department_id = d.id)
        + (select count(*) from public.providers p where p.department_id = d.id)
        + (select count(*) from public.department_services ds where ds.department_id = d.id)
      ) desc,
      d.id
    ) as keep_id,
    row_number() over (
      partition by d.hospital_id, lower(btrim(d.name))
      order by (
        (select count(*) from public.slots s where s.department_id = d.id)
        + (select count(*) from public.providers p where p.department_id = d.id)
        + (select count(*) from public.department_services ds where ds.department_id = d.id)
      ) desc,
      d.id
    ) as rank
  from public.departments d
) ranked
where rank > 1;

update public.slots s
   set department_id = m.keep_id
  from _flowcare_department_merge m
 where s.department_id = m.duplicate_id;

update public.providers p
   set department_id = m.keep_id
  from _flowcare_department_merge m
 where p.department_id = m.duplicate_id;

update public.department_services ds
   set department_id = m.keep_id
  from _flowcare_department_merge m
 where ds.department_id = m.duplicate_id;

delete from public.departments d
 using _flowcare_department_merge m
 where d.id = m.duplicate_id;

create unique index if not exists departments_hospital_name_uidx
  on public.departments (hospital_id, lower(btrim(name)));

insert into public.fc_schema_migrations(version) values ('0024_deduplicate_departments')
  on conflict (version) do nothing;

commit;
