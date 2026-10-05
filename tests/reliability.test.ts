import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deriveReliability } from '@/lib/reliability/derive';
import { RELIABILITY_RULES } from '@/lib/reliability/types';
import type { Appointment, AppointmentEvent } from '@/lib/types';

const appointment = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'apt-1', hospitalId: 'hospital-1', patientId: 'patient-1', departmentId: 'dept-1',
  sessionId: 'slot-1', scheduledFor: '2030-01-02T10:00:00.000Z', status: 'booked',
  completedAt: null, ...over,
});

const event = (over: Partial<AppointmentEvent> = {}): AppointmentEvent => ({
  id: 'event-1', appointmentId: 'apt-1', action: 'complete', fromStatus: 'in_progress',
  toStatus: 'completed', actorSide: 'hospital', actorRole: 'staff', actorId: 'staff-1',
  reason: null, createdAt: '2030-01-02T11:00:00.000Z', ...over,
});

describe('patient reliability rules', () => {
  it('starts at 100 and rewards one verified completion once', () => {
    const result = deriveReliability([appointment()], [event()]);
    expect(result.score).toBe(100);
    expect(result.completedCount).toBe(1);
    expect(result.pointHistory).toHaveLength(1);
  });

  it('does not double count a completed event and completed status', () => {
    const result = deriveReliability(
      [appointment({ status: 'completed', completedAt: '2030-01-02T11:00:00.000Z' })],
      [event()],
    );
    expect(result.score).toBe(100);
    expect(result.completedCount).toBe(1);
  });

  it('lowers the score through repeated official no-show events', () => {
    const appointments = [1, 2, 3].map((n) => appointment({ id: `apt-${n}`, status: 'no_show' }));
    const result = deriveReliability(appointments, appointments.map((a, i) => event({
      id: `event-${i}`, appointmentId: a.id, action: 'no_show', toStatus: 'no_show',
      createdAt: `2030-01-0${i + 2}T10:00:00.000Z`,
    })));
    expect(result.score).toBe(RELIABILITY_RULES.startingScore + (RELIABILITY_RULES.noShow * 3));
    expect(result.noShowCount).toBe(3);
  });

  it('counts official cancellations without penalising a normal cancellation', () => {
    const result = deriveReliability(
      [appointment({ status: 'cancelled' })],
      [event({ action: 'cancel', toStatus: 'cancelled' })],
    );
    expect(result.cancelledCount).toBe(1);
    expect(result.score).toBe(100);
  });

  it('applies a small deduction only for an official late cancellation', () => {
    const late = deriveReliability(
      [appointment()],
      [event({ action: 'cancel', toStatus: 'cancelled', createdAt: '2030-01-01T12:00:00.000Z' })],
    );
    const early = deriveReliability(
      [appointment()],
      [event({ action: 'cancel', toStatus: 'cancelled', createdAt: '2029-12-20T12:00:00.000Z' })],
    );
    expect(late.score).toBe(100 + RELIABILITY_RULES.lateCancellation);
    expect(late.lateCancellationCount).toBe(1);
    expect(early.score).toBe(100);
    expect(early.lateCancellationCount).toBe(0);
  });

  it('never creates a no-show merely because the scheduled time has passed', () => {
    const result = deriveReliability([appointment({ scheduledFor: '2020-01-02T10:00:00.000Z' })], []);
    expect(result.score).toBe(100);
    expect(result.noShowCount).toBe(0);
  });
});

describe('reliability migration boundaries', () => {
  const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/0026_patient_reliability.sql'), 'utf8');

  it('uses an appointment/event uniqueness key and conflict-safe insertion', () => {
    expect(sql).toContain('unique (appointment_id, event_type)');
    expect(sql).toContain('create table if not exists public.patient_reliability_scores');
    expect(sql).toContain('on conflict (appointment_id, event_type) do nothing');
    expect(sql).toContain("'cancelledCount', cancelled_count");
  });

  it('keeps hospital reads relationship-scoped and history privacy-safe', () => {
    expect(sql).toContain("private.allowed(a.hospital_id, 'appointments:read')");
    expect(sql).toContain('limit 5');
    expect(sql).toContain('v.hospital_id = a.hospital_id');
    expect(sql).toContain("new.action not in ('complete', 'cancel', 'no_show')");
    expect(sql).not.toContain('patient_reliability_events to authenticated');
  });
});
