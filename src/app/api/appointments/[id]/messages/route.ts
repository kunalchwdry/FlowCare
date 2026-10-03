import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ body: z.string().trim().min(1).max(1000) }).strict();

async function patientAppointment(id: string) {
  const user = await getSession();
  if (!user) return { user: null, appointment: null };
  const repo = await getRepo();
  const appointment = await repo.getAppointment(id);
  if (!appointment || appointment.patientId !== user.id) return { user, appointment: null };
  return { user, appointment, repo };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const result = await patientAppointment(id);
    if (!result.user) return fail(401, 'Sign in to see appointment messages.');
    if (!result.appointment) return fail(404, 'That appointment could not be found.');
    const messages = await result.repo!.listAppointmentMessages(id);
    return ok({ messages });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to send a message.');
    const rl = rateLimit(`appointment-message:${clientKey(req)}`, 20);
    if (!rl.allowed) return fail(429, 'Too many messages at once. Please wait a moment.');

    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 1400));
    const repo = await getRepo();
    const appointment = await repo.getAppointment(id);
    if (!appointment || appointment.patientId !== user.id) return fail(404, 'That appointment could not be found.');

    const message = await repo.sendAppointmentMessage({
      appointmentId: id,
      senderSide: 'patient',
      senderId: user.id,
      body: body.body,
    });
    return ok({ message });
  } catch (e) {
    if (e instanceof Error && e.message === 'INVALID_INPUT') return fail(400, 'Write a message of up to 1,000 characters.');
    if (e instanceof Error && e.message === 'NOT_FOUND') return fail(404, 'That appointment could not be found.');
    return handleError(e);
  }
}
