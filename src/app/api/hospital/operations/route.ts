import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok, readJson } from '@/lib/http';
import type { NewOperationalDepartment, NewOperationalService, NewOperationalSlot, NewProvider, NewProviderSchedule } from '@/lib/operations/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    const repo = await getRepo();
    const [departments, services, providers, schedules, slots] = await Promise.all([
      repo.listOperationalDepartments(actor.hospitalId), repo.listOperationalServices(actor.hospitalId), repo.listProviders(actor.hospitalId), repo.listProviderSchedules(), repo.listOperationalSlots(actor.hospitalId),
    ]);
    return ok({ departments, services, providers, schedules, slots, source: repo.kind === 'demo' ? 'demo_simulated' : 'database', updatedAt: new Date().toISOString() });
  } catch (e) { return handleError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    const body = await readJson<Record<string, unknown>>(req);
    const resource = body.resource;
    const repo = await getRepo();
    if (resource === 'department') {
      if (!actor.permissions.includes('structure:manage')) return fail(403, 'Your hospital permission does not allow department management.');
      const input: NewOperationalDepartment = {
        hospitalId: actor.hospitalId, name: String(body.name ?? ''), bookingOpen: body.bookingOpen !== false,
        consultationCapacity: Number(body.consultationCapacity ?? 4), noShowGraceMinutes: body.noShowGraceMinutes == null ? 30 : Number(body.noShowGraceMinutes),
        approvalResponseWindowMinutes: Number(body.approvalResponseWindowMinutes ?? 240), waitlistEnabled: body.waitlistEnabled !== false,
        recoveryPolicy: (body.recoveryPolicy as NewOperationalDepartment['recoveryPolicy']) ?? 'offer_alternatives',
        queueOrderRule: (body.queueOrderRule as NewOperationalDepartment['queueOrderRule']) ?? 'arrival_order',
      };
      return ok({ department: await repo.createOperationalDepartment(input) }, { status: 201 });
    }
    if (resource === 'service') {
      if (!actor.permissions.includes('structure:manage')) return fail(403, 'Your hospital permission does not allow service management.');
      const input: NewOperationalService = { departmentId: String(body.departmentId ?? ''), serviceSlug: String(body.serviceSlug ?? ''), label: String(body.label ?? ''), active: body.active !== false };
      return ok({ service: await repo.createOperationalService(input) }, { status: 201 });
    }
    if (resource === 'provider') {
      if (!actor.permissions.includes('structure:manage')) return fail(403, 'Your hospital permission does not allow provider management.');
      const input: NewProvider = { hospitalId: actor.hospitalId, departmentId: String(body.departmentId ?? ''), name: String(body.name ?? ''), specialty: body.specialty == null ? null : String(body.specialty), qualification: body.qualification == null ? null : String(body.qualification), active: body.active !== false };
      return ok({ provider: await repo.createProvider(input) }, { status: 201 });
    }
    if (resource === 'schedule') {
      if (!actor.permissions.includes('structure:manage') && !actor.permissions.includes('slots:manage')) return fail(403, 'Your hospital permission does not allow schedule management.');
      const input: NewProviderSchedule = { providerId: String(body.providerId ?? ''), weekday: Number(body.weekday ?? 0), startsAt: String(body.startsAt ?? ''), endsAt: String(body.endsAt ?? ''), timezone: body.timezone ? String(body.timezone) : 'Asia/Kolkata', active: body.active !== false };
      return ok({ schedule: await repo.createProviderSchedule(input) }, { status: 201 });
    }
    if (resource === 'slot') {
      if (!actor.permissions.includes('slots:manage') && !actor.permissions.includes('structure:manage')) return fail(403, 'Your hospital permission does not allow slot management.');
      const input: NewOperationalSlot = {
        departmentId: String(body.departmentId ?? ''), providerId: body.providerId ? String(body.providerId) : null,
        serviceSlug: body.serviceSlug ? String(body.serviceSlug) : null, startsAt: String(body.startsAt ?? ''), endsAt: String(body.endsAt ?? ''),
        kind: body.kind === 'queue_session' ? 'queue_session' : 'appointment', capacity: Number(body.capacity ?? 1), bookingOpen: body.bookingOpen !== false,
        slotType: (body.slotType as NewOperationalSlot['slotType']) ?? 'approval_required', waitlistEnabled: body.waitlistEnabled == null ? undefined : Boolean(body.waitlistEnabled),
        approvalResponseWindowMinutes: Number(body.approvalResponseWindowMinutes ?? 240), recoveryPolicy: (body.recoveryPolicy as NewOperationalSlot['recoveryPolicy']) ?? 'offer_alternatives',
        expiresAt: body.expiresAt ? String(body.expiresAt) : null,
      };
      return ok({ slot: await repo.createOperationalSlot(input) }, { status: 201 });
    }
    return fail(400, 'resource must be department, provider, schedule, or slot.');
  } catch (e) { return handleError(e); }
}
