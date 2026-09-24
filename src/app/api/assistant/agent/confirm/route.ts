import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AGENT_VERSION } from '@/lib/ai/agent';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The ONLY write path in the agentic workflow.
 *
 * Note what this endpoint accepts: a proposal id. Nothing else. It does not
 * take a slot, a hospital, a name or a date, because if it did, the assistant
 * transcript would be able to influence what gets booked. The payload was
 * assembled server-side in the previous step from rows that were read out of
 * the database, and it is re-read here from the proposal row rather than
 * trusted from the client.
 */
const Body = z
  .object({
    proposalId: z.string().uuid(),
    /** 'confirm' executes; 'cancel' discards. Nothing else is accepted. */
    decision: z.enum(['confirm', 'cancel']).default('confirm'),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`agentconfirm:${clientKey(req)}`, 20);
    if (!rl.allowed) return fail(429, 'Too many requests. Please wait a minute.');

    const body = Body.parse(await readJson(req, 1000));

    const sb = await getSupabaseServerClient();
    if (!sb) return fail(503, 'Supabase is not configured on this server.');
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) return fail(401, 'Sign in to confirm a booking.');

    // ---- user declined ---------------------------------------------------
    if (body.decision === 'cancel') {
      const { error } = await sb.rpc('close_agent_proposal', {
        p_id: body.proposalId,
        p_status: 'cancelled',
      });
      if (error) return fail(400, cleanErr(error.message));
      return ok({ version: AGENT_VERSION, step: 'done', cancelled: true, message: 'Discarded. Nothing was booked.' });
    }

    // ---- mark confirmed (atomic; rejects expired//already-decided) -------
    const { data: confirmed, error: confirmErr } = await sb.rpc('confirm_agent_proposal', {
      p_id: body.proposalId,
    });
    if (confirmErr) return fail(409, cleanErr(confirmErr.message));

    const proposal = Array.isArray(confirmed) ? confirmed[0] : confirmed;
    if (!proposal) return fail(404, 'That suggestion no longer exists.');

    // confirm_agent_proposal() deliberately does not raise on expiry (raising
    // would roll back the row that records it), so the status is authoritative
    // and must be checked here.
    if (proposal.status === 'expired') {
      return fail(409, 'That suggestion expired before you confirmed it. Please ask again.');
    }
    if (proposal.status !== 'confirmed') {
      return fail(409, 'That suggestion is no longer pending.');
    }
    if (proposal.kind !== 'book_appointment') {
      return fail(400, 'That suggestion cannot be carried out.');
    }

    // Re-read the payload from the stored row, never from the request.
    const payload = proposal.payload as {
      slotId: string; patientName: string; hospitalName: string; departmentName: string;
    };

    // Deterministic idempotency key: confirming twice books once. Derived
    // from the proposal id, so a double-tap or a retried request cannot
    // produce two appointments.
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`agent:${proposal.id}`)
      .digest('hex')
      .slice(0, 40);

    const { data: booked, error: bookErr } = await sb.rpc('book_appointment', {
      p_slot: payload.slotId,
      p_name: payload.patientName,
      p_key: idempotencyKey,
    });

    if (bookErr) {
      // Record why, so the user sees a real reason rather than a generic
      // failure, and so the proposal is not left dangling as "confirmed".
      await sb.rpc('close_agent_proposal', {
        p_id: proposal.id,
        p_status: 'failed',
        p_error: firstCode(bookErr.message),
      });
      return fail(409, bookingMessage(bookErr.message));
    }

    const appointment = Array.isArray(booked) ? booked[0] : booked;
    await sb.rpc('record_agent_result', {
      p_id: proposal.id,
      p_result: appointment ?? {},
    });

    // Fetch the receipt so the UI can state plainly that this is a REQUEST.
    let receipt: unknown = null;
    if (appointment?.id) {
      const { data: r } = await sb.rpc('appointment_receipt', { p_id: appointment.id });
      receipt = r ?? null;
    }

    return ok({
      version: AGENT_VERSION,
      step: 'done',
      message:
        `Request sent to ${payload.hospitalName} for ${payload.departmentName}. ` +
        `This is a request, not a confirmed appointment — the hospital still has to accept it.`,
      appointment: appointment ?? null,
      receipt,
      notices: [
        'You will see the status change on your Visits page once the hospital responds.',
        'Do not travel until the hospital confirms.',
      ],
    });
  } catch (e) {
    return handleError(e);
  }
}

function firstCode(message: string): string {
  const m = message.match(/([A-Z_]{3,40}):/);
  return m ? m[1] : 'BOOKING_FAILED';
}

/** Map the database's error vocabulary onto something a patient can act on. */
function bookingMessage(message: string): string {
  if (/CAPACITY_FULL/.test(message)) return 'That time filled up while you were deciding. Please pick another.';
  if (/CONSULTATION_FULL/.test(message)) return 'That department is fully booked for that session.';
  if (/BOOKING_CLOSED/.test(message)) return 'Booking has closed for that time.';
  if (/VERSION_CONFLICT/.test(message)) return 'That slot changed while you were deciding. Please try again.';
  if (/IDEMPOTENCY_CONFLICT/.test(message)) return 'This request was already sent.';
  if (/AUTH_REQUIRED/.test(message)) return 'Sign in to book.';
  if (/NOT_FOUND/.test(message)) return 'That time is no longer available.';
  return 'The hospital system did not accept that request.';
}

function cleanErr(message: string): string {
  const m = message.match(
    /(?:INVALID_INPUT|NOT_FOUND|LIMIT_REACHED|AUTH_REQUIRED|INVALID_TRANSITION):\s*(.*)/,
  );
  return m ? m[1] : 'Could not carry out that suggestion.';
}
