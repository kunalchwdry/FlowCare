import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson, tooMany } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Appointment booking/request.
 *
 * Every slot creates a pending request. An instant slot is a published
 * availability signal, not a hospital confirmation; the response reports
 * the appointment state that was actually persisted.
 *
 * The client sends a session id and nothing else that matters: department,
 * hospital and time are all read from the session server-side, so a tampered
 * payload cannot book a different department or a time the hospital never
 * published.
 */
const Body = z
  .object({
    sessionId: z.string().min(1).max(200),
    /** Administrative only. Never store or infer a clinical detail here. */
    reason: z.string().trim().max(280).optional(),
  })
  .strict();

/**
 * Open slots a patient can actually request, for one hospital.
 *
 * Exposed because the booking UI and the tests must agree on what "open"
 * means. Nothing here is personal data: it is the same session availability
 * the hospital publishes on its FlowCare page.
 */
export async function GET(req: NextRequest) {
  try {
    const hospitalRef = req.nextUrl.searchParams.get('hospital');
    if (!hospitalRef) return fail(400, 'A hospital is required.');
    const repo = await getRepo();
    const hospital = await repo.getHospital(hospitalRef);
    if (!hospital) return fail(404, 'Hospital not found.');

    const department = req.nextUrl.searchParams.get('department');
    const selectedDepartment = department
      ? hospital.departments.find((d) => d.id === department || d.specialty === department)
      : null;
    const sessions = (await repo.listSessions([hospital.id]))
      .filter((s) => s.status === 'open' && s.capacity > s.booked)
      .filter((s) => !selectedDepartment || s.departmentId === selectedDepartment.id || s.departmentId.endsWith(`:dept:${selectedDepartment.specialty}`))
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));

    return ok({
      hospitalId: hospital.id,
      sessions: sessions.map((s) => ({
        id: s.id,
        departmentId: s.departmentId,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity: s.capacity,
        booked: s.booked,
      })),
      notice: 'Open sessions recorded by the hospital in FlowCare. Requesting one does not confirm it.',
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to request an appointment.');

    const limited = rateLimit(`appointments:${user.id}`, 10, 60_000);
    if (!limited.allowed) return tooMany('Too many appointment requests. Try again shortly.', limited.resetInMs);

    const input = Body.parse(await readJson(req, 2000));
    const repo = await getRepo();

    let appointment;
    try {
      appointment = await repo.requestAppointment({
        patientId: user.id,
        sessionId: input.sessionId,
        reason: input.reason ?? null,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      if (code === 'NOT_FOUND') return fail(404, 'That session no longer exists.');
      if (code === 'BOOKING_CLOSED') return fail(409, 'That session is no longer open for requests.');
      if (code === 'CAPACITY_FULL') return fail(409, 'That session filled up while you were choosing.');
      throw e;
    }

    await repo.recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: 'appointment.request',
      entity: 'appointment',
      entityId: appointment.id,
      metadata: { hospital_id: appointment.hospitalId, session_id: appointment.sessionId },
    });

    return ok(
      {
        appointment,
        confirmed: appointment.status === 'booked',
        notice: appointment.status === 'booked'
          ? 'Confirmed. The hospital accepted this appointment request.'
          : 'Requested. The hospital has not confirmed this yet — wait for confirmation before travelling.',
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}
