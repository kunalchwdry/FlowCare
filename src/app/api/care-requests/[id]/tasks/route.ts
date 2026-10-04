import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  ownerType: z.literal('patient'),
  ownerId: z.string().max(160).nullable().optional(),
  taskType: z.enum(['missing_document', 'transport', 'language', 'accessibility', 'referral_information', 'coverage', 'appointment', 'follow_up', 'other']),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
}).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to add a care task.');
    const { id } = await ctx.params;
    const body = Body.parse(await readJson(req, 3000));
    const repo = await getRepo();
    const request = await repo.getCareRequest(id);
    if (!request || request.patientId !== user.id) return fail(404, 'Care journey not found.');
    const task = await repo.createCareTask({
      careRequestId: id, episodeId: request.episodeId, patientId: user.id,
      hospitalId: request.selectedHospitalId, ownerType: 'patient', ownerId: user.id,
      taskType: body.taskType, title: body.title, description: body.description ?? null, deadline: body.deadline ?? null,
    });
    return ok({ task }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
