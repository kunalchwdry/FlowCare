-- ===========================================================================
-- 0026_patient_reliability.sql — verified patient reliability + visit history
-- ===========================================================================
-- Additive only. Reliability is derived from the existing appointment row and
-- append-only appointment_events trail. No client can write a score, event, or
-- visit. `visit_records` remains the separate, patient-entered continuity log.
-- ===========================================================================

create table if not exists public.patient_reliability_events (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  event_type     text not null check (event_type in ('attended','late_cancellation','no_show')),
  points_delta   integer not null check (points_delta between -100 and 100),
  occurred_at    timestamptz not null default clock_timestamp(),
  unique (appointment_id, event_type)
);

create index if not exists patient_reliability_events_patient_idx
  on public.patient_reliability_events (patient_id, occurred_at desc);

-- Materialized current score for fast reads and an auditable update timestamp.
-- It is maintained only by the appointment-event trigger below.
create table if not exists public.patient_reliability_scores (
  patient_id    uuid primary key references auth.users(id) on delete cascade,
  current_points integer not null check (current_points between 0 and 100),
  updated_at    timestamptz not null default clock_timestamp()
);

alter table public.patient_reliability_scores enable row level security;
revoke all on public.patient_reliability_scores from anon, authenticated;

-- The table is deliberately not directly readable or writable by browser
-- roles. SECURITY DEFINER read functions below return only the safe projection.
alter table public.patient_reliability_events enable row level security;
revoke all on public.patient_reliability_events from anon, authenticated;

comment on table public.patient_reliability_events is
  'Immutable, appointment-linked reliability facts. Written only by the appointment event trigger; unique appointment/type prevents duplicate deductions.';

-- One database-side policy surface. The TypeScript mirror is used only for
-- presentation/demo derivation; all live writes and live reads use these
-- SECURITY DEFINER rules.
create or replace function private.reliability_starting_score()
returns integer language sql immutable set search_path to '' as $$ select 100 $$;

create or replace function private.reliability_points(p_event_type text)
returns integer language sql immutable set search_path to '' as $$
  select case p_event_type
    when 'attended' then 1
    when 'late_cancellation' then -3
    when 'no_show' then -10
    else 0
  end
$$;

create or replace function private.reliability_late_window()
returns interval language sql immutable set search_path to '' as $$ select interval '24 hours' $$;

create or replace function private.reliability_status(p_score integer)
returns text language sql immutable set search_path to '' as $$
  select case when p_score >= 90 then 'excellent'
    when p_score >= 75 then 'good'
    when p_score >= 50 then 'needs_improvement'
    else 'poor' end
$$;

create or replace function private.record_patient_reliability_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appointments;
  s public.slots;
  event_type text;
  delta integer;
  current_score integer;
begin
  -- Only official state-machine outcomes can reach this trigger. In
  -- particular, time passing never creates a no-show row.
  if new.action not in ('complete', 'cancel', 'no_show') then
    return new;
  end if;

  select * into a from public.appointments where id = new.appointment_id;
  if not found then return new; end if;

  if new.action = 'complete' then
    event_type := 'attended';
    delta := private.reliability_points(event_type);
  elsif new.action = 'no_show' then
    event_type := 'no_show';
    delta := private.reliability_points(event_type);
  else
    -- A late cancellation is a small, fixed deduction only when the real slot
    -- start is known and the official cancellation was within 24 hours.
    select * into s from public.slots where id = a.slot_id;
    if not found or s.starts_at < new.occurred_at
       or s.starts_at - new.occurred_at > private.reliability_late_window() then
      return new;
    end if;
    event_type := 'late_cancellation';
    delta := private.reliability_points(event_type);
  end if;

  insert into public.patient_reliability_events(
    patient_id, appointment_id, event_type, points_delta, occurred_at
  ) values (
    a.patient_id, a.id, event_type, delta, new.occurred_at
  ) on conflict (appointment_id, event_type) do nothing;

  -- FOUND is false on a duplicate event, so a replay cannot move the score.
  if found then
    -- Recompute from the complete verified event/status projection so a
    -- patient's pre-migration history is included and an out-of-order event
    -- cannot make the materialized score diverge from the read function.
    current_score := (private.patient_reliability_json(a.patient_id, false)->>'score')::integer;
    insert into public.patient_reliability_scores(patient_id, current_points, updated_at)
    values (a.patient_id, current_score, new.occurred_at)
    on conflict (patient_id) do update set
      current_points = excluded.current_points,
      updated_at = excluded.updated_at;
  end if;

  return new;
end $$;

drop trigger if exists appointment_events_reliability on public.appointment_events;
create trigger appointment_events_reliability
after insert on public.appointment_events
for each row execute function private.record_patient_reliability_event();

-- Internal projection. Fallback rows cover verified completed/no-show
-- appointments created before this migration; each is excluded once the
-- trigger has materialised its corresponding idempotent event.
create or replace function private.patient_reliability_json(
  p_patient uuid,
  p_include_history boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with rows as (
  select e.id, e.appointment_id, e.event_type, e.points_delta, e.occurred_at
    from public.patient_reliability_events e
   where e.patient_id = p_patient
  union all
  select a.id, a.id, 'attended', 1,
         coalesce((select max(e.occurred_at) from public.appointment_events e
                    where e.appointment_id = a.id and e.action = 'complete'),
                  a.created_at)
    from public.appointments a
   where a.patient_id = p_patient
     and (a.status = 'completed' or exists (
       select 1 from public.appointment_events e
        where e.appointment_id = a.id and e.action = 'complete'
     ))
     and not exists (
       select 1 from public.patient_reliability_events e
        where e.appointment_id = a.id and e.event_type = 'attended'
     )
  union all
  select a.id, a.id, 'no_show', -10,
         coalesce((select max(e.occurred_at) from public.appointment_events e
                    where e.appointment_id = a.id and e.action = 'no_show'),
                  a.created_at)
    from public.appointments a
   where a.patient_id = p_patient
     and a.status = 'no_show'
     and not exists (
       select 1 from public.patient_reliability_events e
        where e.appointment_id = a.id and e.event_type = 'no_show'
     )
), summary as (
  select
    greatest(0, least(100, private.reliability_starting_score() + coalesce(sum(points_delta), 0)))::integer as score,
    count(*) filter (where event_type = 'attended')::integer as completed_count,
    (select count(distinct a.id)::integer
       from public.appointments a
      where a.patient_id = p_patient
        and (a.status = 'cancelled' or exists (
          select 1 from public.appointment_events ce
           where ce.appointment_id = a.id and ce.action = 'cancel'
        ))) as cancelled_count,
    count(*) filter (where event_type = 'late_cancellation')::integer as late_cancellation_count,
    count(*) filter (where event_type = 'no_show')::integer as no_show_count,
    coalesce((select updated_at from public.patient_reliability_scores where patient_id = p_patient), max(occurred_at)) as updated_at
  from rows
)
select jsonb_build_object(
  'score', score,
  'updatedAt', updated_at,
  'status', private.reliability_status(score),
  'completedCount', completed_count,
  'cancelledCount', cancelled_count,
  'lateCancellationCount', late_cancellation_count,
  'noShowCount', no_show_count,
  'pointHistory', case when p_include_history then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'appointmentId', r.appointment_id,
      'type', r.event_type,
      'pointsDelta', r.points_delta,
      'occurredAt', r.occurred_at
    ) order by r.occurred_at desc)
    from rows r
  ), '[]'::jsonb) else '[]'::jsonb end
)
from summary;
$$;

-- Idempotent migration-time backfill for existing completed/no-show/late
-- cancellation outcomes. It derives from the same projection as reads and
-- inserts nothing for patients with no reliability outcomes.
insert into public.patient_reliability_scores(patient_id, current_points, updated_at)
select patients.patient_id,
       (projection.value->>'score')::integer,
       (projection.value->>'updatedAt')::timestamptz
  from (select distinct patient_id from public.appointments) patients
  cross join lateral (
    select private.patient_reliability_json(patients.patient_id, false) as value
  ) projection
 where projection.value->>'updatedAt' is not null
on conflict (patient_id) do nothing;

-- Patient-owned summary and point history. Passing somebody else's id is not
-- a search primitive: it is rejected at the database boundary.
create or replace function public.get_patient_reliability(p_patient uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.actor();
    target uuid := coalesce(p_patient, actor);
begin
  if target <> actor then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  return private.patient_reliability_json(target, true);
end $$;

grant execute on function public.get_patient_reliability(uuid) to authenticated;

-- Verified history is derived from completed appointment/visit state. It is
-- not the manually editable public.visit_records table. Only where/when and
-- operational labels are returned; there are no diagnoses, notes, reports,
-- prescriptions, documents, or appointment reasons.
create or replace function public.get_patient_visit_history(p_patient uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.actor();
    target uuid := coalesce(p_patient, actor);
begin
  if target <> actor then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'appointmentId', a.id,
      'hospitalId', h.id,
      'hospitalName', h.name,
      'departmentName', d.name,
      'visitDate', s.starts_at,
      'status', 'completed',
      'appointmentKind', s.kind
    ) order by s.starts_at desc)
    from public.appointments a
    join public.hospitals h on h.id = a.hospital_id
    join public.departments d on d.id = a.department_id
    join public.slots s on s.id = a.slot_id
    where a.patient_id = target
      and (a.status = 'completed' or exists (
        select 1 from public.appointment_events e
         where e.appointment_id = a.id and e.action = 'complete'
      ) or exists (
        select 1 from public.visits v
         where v.appointment_id = a.id and v.state = 'completed'
      ))
  ), '[]'::jsonb);
end $$;

grant execute on function public.get_patient_visit_history(uuid) to authenticated;

-- Hospital projection. The only input is an appointment id already in the
-- hospital's relationship scope; a staff member cannot supply an arbitrary
-- patient id or enumerate the system.
create or replace function public.get_hospital_patient_profile(p_appointment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.appointments;
  profile jsonb;
  visits jsonb;
begin
  select * into a from public.appointments where id = p_appointment;
  if not found or not private.allowed(a.hospital_id, 'appointments:read') then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  profile := private.patient_reliability_json(a.patient_id, false);
  select coalesce(jsonb_agg(x.row order by x.visit_date desc), '[]'::jsonb)
    into visits
    from (
      select jsonb_build_object(
        'appointmentId', v.id,
        'hospitalId', h.id,
        'hospitalName', h.name,
        'departmentName', d.name,
        'visitDate', s.starts_at,
        'status', 'completed',
        'appointmentKind', s.kind
      ) as row, s.starts_at as visit_date
      from public.appointments v
      join public.hospitals h on h.id = v.hospital_id
      join public.departments d on d.id = v.department_id
      join public.slots s on s.id = v.slot_id
      where v.patient_id = a.patient_id
        and v.hospital_id = a.hospital_id
        and (v.status = 'completed' or exists (
          select 1 from public.appointment_events e
           where e.appointment_id = v.id and e.action = 'complete'
        ) or exists (
          select 1 from public.visits vv
           where vv.appointment_id = v.id and vv.state = 'completed'
        ))
      order by s.starts_at desc
      limit 5
    ) x;

  return jsonb_build_object(
    'patientId', a.patient_id,
    'reliability', profile - 'pointHistory',
    'recentVisits', visits
  );
end $$;

grant execute on function public.get_hospital_patient_profile(uuid) to authenticated;

insert into public.fc_schema_migrations(version)
values ('0026_patient_reliability')
on conflict (version) do nothing;
