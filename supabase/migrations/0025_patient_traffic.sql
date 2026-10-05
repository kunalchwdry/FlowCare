/*
  0025_patient_traffic.sql

  Patient Traffic is a privacy-safe aggregate over the existing appointment
  lifecycle. It does not create a second queue, copy patient rows, or use
  road/GPS data. Check-in and consultation are derived from the existing
  appointment_events trail because the live core stores the appointment row
  as `confirmed` while those operational states are events.

  Public callers receive only an aggregate for published hospitals. A caller
  with queue:read for one hospital may receive the same aggregate plus
  department counts for that hospital. No patient id, name, appointment id,
  provider identity, or medical field crosses this function.
*/

begin;

create index if not exists appointment_events_traffic_idx
  on public.appointment_events (appointment_id, version desc, occurred_at desc);

-- Keep these database-side safety limits in sync with TRAFFIC_THRESHOLDS in
-- src/lib/traffic/traffic.ts. They govern ETA reliability only; the LOW /
-- MODERATE /
-- HIGH waiting-count thresholds are applied by that shared domain utility.
-- 15 minutes stale, 240 minutes maximum reliable wait.

create or replace function public.list_patient_traffic(p_hospital uuid default null)
returns table (
  hospital_id uuid,
  available boolean,
  waiting_count integer,
  in_consultation_count integer,
  completed_today integer,
  estimated_wait_minutes integer,
  updated_at timestamptz,
  freshness text,
  by_department jsonb,
  by_provider jsonb
)
language sql
stable
security definer
set search_path to ''
as $function$
with visible_hospitals as (
  select h.id, h.timezone
  from public.hospitals h
  where (p_hospital is null and private.hospital_public(h.id))
     or (p_hospital is not null and h.id = p_hospital and (
          private.hospital_public(h.id)
          or (auth.uid() is not null and private.allowed(h.id, 'queue:read'))
        ))
),
latest_event as (
  select distinct on (e.appointment_id)
    e.appointment_id,
    e.action
  from public.appointment_events e
  order by e.appointment_id, e.version desc, e.occurred_at desc
),
pending_reschedule as (
  select distinct on (m.appointment_id)
    m.appointment_id
  from public.appointment_messages m
  where m.kind = 'time_proposal' and m.proposal_status = 'pending'
  order by m.appointment_id, m.created_at desc
),
today_appointments as (
  select
    a.id,
    a.hospital_id,
    a.department_id,
    d.name as department_name,
    s.provider_id,
    p.name as provider_name,
    a.status as database_status,
    case
      when pr.appointment_id is not null then 'reschedule_proposed'
      when a.status in ('confirmed', 'booked') and le.action = 'check_in' then 'checked_in'
      when a.status in ('confirmed', 'booked') and le.action = 'start' then 'in_progress'
      when a.status in ('confirmed', 'booked') and le.action = 'complete' then 'completed'
      when a.status in ('confirmed', 'booked') and le.action = 'cancel' then 'cancelled'
      when a.status in ('confirmed', 'booked') and le.action = 'no_show' then 'no_show'
      when a.status = 'confirmed' then 'booked'
      else a.status
    end as traffic_state
  from public.appointments a
  join visible_hospitals vh on vh.id = a.hospital_id
  join public.departments d on d.id = a.department_id
  join public.slots s on s.id = a.slot_id
  left join public.providers p on p.id = s.provider_id and p.hospital_id = a.hospital_id
  left join latest_event le on le.appointment_id = a.id
  left join pending_reschedule pr on pr.appointment_id = a.id
  where (s.starts_at at time zone coalesce(vh.timezone, 'Asia/Kolkata'))::date
        = (clock_timestamp() at time zone coalesce(vh.timezone, 'Asia/Kolkata'))::date
),
counts as (
  select
    vh.id as hospital_id,
    (count(ta.id) filter (where ta.traffic_state in ('booked', 'checked_in')))::integer as waiting_count,
    (count(ta.id) filter (where ta.traffic_state = 'in_progress'))::integer as in_consultation_count,
    (count(ta.id) filter (where ta.traffic_state = 'completed'))::integer as completed_today,
    count(ta.id) filter (where ta.traffic_state in ('booked', 'checked_in', 'in_progress', 'completed')) > 0 as available
  from visible_hospitals vh
  left join today_appointments ta on ta.hospital_id = vh.id
  group by vh.id
),
wait_estimates as (
  select
    c.hospital_id,
    case
      when count(qe.id) > 0
       and bool_and(
         qe.estimated_slot_at is not null
         and qe.last_updated_at >= clock_timestamp() - interval '15 minutes'
       )
       and avg(greatest(0, extract(epoch from (qe.estimated_slot_at - clock_timestamp())) / 60.0)) <= 240
      then round(avg(greatest(0, extract(epoch from (qe.estimated_slot_at - clock_timestamp())) / 60.0)))::integer
      else null
    end as estimated_wait_minutes
  from counts c
  left join public.queue_entries qe
    on qe.hospital_id = c.hospital_id
   and qe.status in ('waiting', 'booked')
   and qe.appointment_id in (
     select ta.id
     from today_appointments ta
     where ta.hospital_id = c.hospital_id
       and ta.traffic_state in ('booked', 'checked_in')
   )
  group by c.hospital_id
),
department_counts as (
  select
    ta.hospital_id,
    ta.department_id,
    ta.department_name,
    (count(*) filter (where ta.traffic_state in ('booked', 'checked_in')))::integer as waiting_count,
    (count(*) filter (where ta.traffic_state = 'in_progress'))::integer as in_consultation_count,
    (count(*) filter (where ta.traffic_state = 'completed'))::integer as completed_today
  from today_appointments ta
  where ta.traffic_state in ('booked', 'checked_in', 'in_progress', 'completed')
  group by ta.hospital_id, ta.department_id, ta.department_name
),
provider_counts as (
  select
    ta.hospital_id,
    ta.provider_id,
    ta.provider_name,
    (count(*) filter (where ta.traffic_state in ('booked', 'checked_in')))::integer as waiting_count,
    (count(*) filter (where ta.traffic_state = 'in_progress'))::integer as in_consultation_count,
    (count(*) filter (where ta.traffic_state = 'completed'))::integer as completed_today
  from today_appointments ta
  where ta.provider_id is not null
    and ta.traffic_state in ('booked', 'checked_in', 'in_progress', 'completed')
  group by ta.hospital_id, ta.provider_id, ta.provider_name
),
by_provider as (
  select
    pc.hospital_id,
    jsonb_agg(
      jsonb_build_object(
        'providerId', pc.provider_id,
        'providerName', pc.provider_name,
        'waitingCount', pc.waiting_count,
        'inConsultationCount', pc.in_consultation_count,
        'completedToday', pc.completed_today
      ) order by pc.provider_name
    ) as details
  from provider_counts pc
  group by pc.hospital_id
),
by_department as (
  select
    dc.hospital_id,
    jsonb_agg(
      jsonb_build_object(
        'departmentId', dc.department_id,
        'departmentName', dc.department_name,
        'waitingCount', dc.waiting_count,
        'inConsultationCount', dc.in_consultation_count,
        'completedToday', dc.completed_today
      ) order by dc.department_name
    ) as details
  from department_counts dc
  group by dc.hospital_id
)
select
  c.hospital_id,
  c.available,
  c.waiting_count,
  c.in_consultation_count,
  c.completed_today,
  case when c.available then we.estimated_wait_minutes else null end,
  case when c.available then clock_timestamp() else null end,
  case when c.available then 'fresh' else 'unavailable' end,
  case
    when p_hospital is not null
     and auth.uid() is not null
     and private.allowed(c.hospital_id, 'queue:read')
    then coalesce(bd.details, '[]'::jsonb)
    else '[]'::jsonb
  end,
  case
    when p_hospital is not null
     and auth.uid() is not null
     and private.allowed(c.hospital_id, 'queue:read')
    then coalesce(bp.details, '[]'::jsonb)
    else '[]'::jsonb
  end
from counts c
join wait_estimates we on we.hospital_id = c.hospital_id
left join by_department bd on bd.hospital_id = c.hospital_id
left join by_provider bp on bp.hospital_id = c.hospital_id;
$function$;

comment on function public.list_patient_traffic(uuid) is
  'Privacy-safe aggregate of today''s appointment traffic. Public reads are limited to published hospitals; queue:read staff may see department aggregates for their own hospital. No patient or appointment identity is returned.';

grant execute on function public.list_patient_traffic(uuid) to anon, authenticated;

insert into public.fc_schema_migrations(version) values ('0025_patient_traffic')
  on conflict (version) do nothing;

commit;
