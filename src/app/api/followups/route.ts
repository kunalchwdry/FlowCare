import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import {
  FOLLOWUP_NOTICE, FollowUpInputSchema, groupTasks, validateDueDate,
} from '@/lib/journey/followup';
import type { FollowUpTaskType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * F20 — follow-up closure.
 *
 * The task type is a closed enum and there is no note field. FlowCare never
 * creates a task on its own: inventing "book a follow-up" because a visit
 * happened would be issuing a care instruction we have no basis for (R20).
 */
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to see your reminders.');
    const repo = await getRepo();
    const tasks = await repo.listFollowUpTasks(user.id);
    const hospitals = await repo.listHospitals();
    const byId = new Map(hospitals.map((h) => [h.id, h]));

    const decorate = (t: (typeof tasks)[number]) => ({
      ...t,
      hospitalName: t.hospitalId ? byId.get(t.hospitalId)?.name ?? null : null,
    });

    const grouped = groupTasks(tasks);
    return ok({
      tasks: tasks.map(decorate),
      grouped: {
        overdue: grouped.overdue.map(decorate),
        thisWeek: grouped.thisWeek.map(decorate),
        later: grouped.later.map(decorate),
        closed: grouped.closed.map(decorate),
      },
      notice: FOLLOWUP_NOTICE,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return fail(401, 'Sign in to add a reminder.');
    const input = FollowUpInputSchema.parse(await readJson(req, 2000));

    const due = validateDueDate(input.dueDate);
    if (!due.ok) return fail(400, due.message);

    const repo = await getRepo();
    if (input.hospitalId) {
      const hospital = await repo.getHospital(input.hospitalId);
      if (!hospital) return fail(404, 'Hospital not found');
    }
    if (input.careContextId) {
      const contexts = await repo.listCareContexts(user.id);
      if (!contexts.some((c) => c.id === input.careContextId)) {
        return fail(404, 'Care context not found');
      }
    }

    const task = await repo.createFollowUpTask({
      ownerUserId: user.id,
      careContextId: input.careContextId ?? null,
      hospitalId: input.hospitalId ?? null,
      departmentId: input.departmentId ?? null,
      taskType: input.taskType as FollowUpTaskType,
      dueDate: input.dueDate,
    });

    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'follow_up.create',
      entity: 'follow_up_task', entityId: task.id,
      metadata: { task_type: task.taskType },
    });

    return ok({ task }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
