import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Decision = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'verifying', 'removed']),
  note: z.string().max(1000).nullish(),
}).strict();

async function reviewer() {
  const user = await getSession();
  if (!user) return { user: null, error: fail(401, 'Sign in required.') };
  if (!user.flowcareReviewer) {
    return { user: null, error: fail(403, 'This page is restricted to FlowCare reviewers.') };
  }
  return { user, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const gate = await reviewer();
    if (gate.error) return gate.error;

    const supabase = await getSupabaseServerClient();
    if (!supabase) return fail(503, 'The reviewer queue is not connected to Supabase.');

    const status = req.nextUrl.searchParams.get('status');
    const allowed = status && ['pending', 'verifying', 'approved', 'rejected'].includes(status)
      ? status
      : null;
    const { data, error } = await supabase.rpc('list_hospital_registration_requests', {
      p_status: allowed,
    });
    if (error) return fail(503, error.message);

    const requests = (data ?? []) as Array<Record<string, unknown>>;
    return ok({
      requests,
      summary: {
        pending: requests.filter((r) => r.status === 'pending').length,
        verifying: requests.filter((r) => r.status === 'verifying').length,
        approved: requests.filter((r) => r.status === 'approved').length,
        rejected: requests.filter((r) => r.status === 'rejected').length,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await reviewer();
    if (gate.error) return gate.error;

    const body = Decision.parse(await readJson(req, 4000));
    if ((body.decision === 'rejected' || body.decision === 'removed') && !body.note?.trim()) {
      return fail(400, `Add a reason before ${body.decision === 'removed' ? 'removing a hospital' : 'rejecting an application'}.`);
    }

    const supabase = await getSupabaseServerClient();
    if (!supabase) return fail(503, 'The reviewer queue is not connected to Supabase.');
    const { data, error } = body.decision === 'removed'
      ? await supabase.rpc('remove_hospital_registration', {
          p_request_id: body.requestId,
          p_note: body.note ?? null,
        })
      : await supabase.rpc('decide_hospital_registration', {
          p_request_id: body.requestId,
          p_decision: body.decision,
          p_note: body.note ?? null,
        });
    if (error) {
      if (error.message.includes('ACCOUNT_NOT_CONFIRMED')) {
        return fail(400, 'The applicant must confirm their email before hospital access can be approved.');
      }
      return fail(400, error.message);
    }

    return ok({ result: data });
  } catch (e) {
    return handleError(e);
  }
}
