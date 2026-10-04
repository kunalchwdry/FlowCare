import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { extractCareAccessRequest } from '@/lib/careAccess/extract';
import { matchCareAccessOptions } from '@/lib/careAccess/match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  requestText: z.string().trim().max(500).optional(),
  specialty: z.string().trim().max(80).nullable().optional(),
  serviceType: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  preferredStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredTimeRange: z.string().trim().max(80).nullable().optional(),
  budgetConstraint: z.string().trim().max(120).nullable().optional(),
  accessibilityRequirements: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  languagePreference: z.array(z.string().trim().min(1).max(20)).max(8).optional(),
  coverage: z.string().trim().max(120).nullable().optional(),
  referralRequired: z.boolean().nullable().optional(),
}).strict();

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see your care journeys.');
    const repo = await getRepo();
    const requests = await repo.listCareRequests({ patientId: user.id });
    const payload = await Promise.all(requests.map(async (request) => ({
      request,
      options: await repo.listCareOptions(request.id),
      transitions: await repo.listCareTransitions(request.id),
      tasks: await repo.listCareTasks({ patientId: user.id, careRequestId: request.id }),
    })));
    return ok({ requests: payload });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to start a care request.');
    const body = Body.parse(await readJson(req, 4000));
    if (!body.requestText && !body.serviceType) return fail(400, 'Describe the care access you need.');

    const extracted: Partial<ReturnType<typeof extractCareAccessRequest>> = body.requestText ? extractCareAccessRequest(body.requestText) : {};
    const input = {
      patientId: user.id,
      specialty: body.specialty ?? extracted.specialty ?? null,
      serviceType: body.serviceType ?? extracted.serviceType ?? 'consultation',
      location: body.location ?? extracted.location ?? null,
      preferredStartDate: body.preferredStartDate ?? extracted.preferredStartDate ?? null,
      preferredEndDate: body.preferredEndDate ?? extracted.preferredEndDate ?? null,
      preferredTimeRange: body.preferredTimeRange ?? extracted.preferredTimeRange ?? null,
      budgetConstraint: body.budgetConstraint ?? extracted.budgetConstraint ?? null,
      accessibilityRequirements: body.accessibilityRequirements ?? extracted.accessibilityRequirements ?? [],
      languagePreference: body.languagePreference ?? extracted.languagePreference ?? [],
      coverage: body.coverage ?? extracted.coverage ?? null,
      referralRequired: body.referralRequired ?? extracted.referralRequired ?? null,
    };

    const repo = await getRepo();
    const request = await repo.createCareRequest(input);
    const screened = await repo.transitionCareRequest({
      careRequestId: request.id, action: 'screen', actor: 'system', actorId: 'system', actorRole: 'system',
      expectedVersion: request.version, metadata: { patientId: request.patientId },
    });
    const options = await matchCareAccessOptions(repo, screened);
    const saved = await repo.saveCareOptions(request.id, options);
    const offered = await repo.transitionCareRequest({
      careRequestId: request.id, action: 'offer_options', actor: 'system', actorId: 'system', actorRole: 'system',
      expectedVersion: screened.version, metadata: { optionCount: saved.length, patientId: request.patientId },
    });
    return ok({ request: offered, options: saved, extracted: input }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
