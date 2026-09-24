/**
 * F20 — Follow-up closure.
 *
 * Problem P21: the loop that most often breaks is "come back in three weeks"
 * and "collect the report on Tuesday". S35 (Kessels) puts immediate recall
 * loss at 40–80%, with roughly half of what is retained being wrong.
 *
 * HARD CONSTRAINTS (docs/research/03-review-and-plan.md §10.1 R20):
 *  1. CLOSED ENUM ONLY. No free text. A free-text follow-up note becomes a
 *     clinical record (§9.1) the moment a user types "recheck the biopsy".
 *  2. FlowCare NEVER generates the task. The patient records what they were
 *     told. We do not infer that a cardiology visit implies a follow-up,
 *     because inventing a care instruction is worse than forgetting one.
 *  3. A reminder is logistics, not medicine. Copy never implies urgency or
 *     consequence — S12 found the SMS subgroup effect was not significant,
 *     so we make no claim that this improves attendance.
 */
import { z } from 'zod';
import { FOLLOW_UP_TASK_TYPES, FOLLOW_UP_TYPE_CODES } from '@/lib/journey/vocab';
import type { FollowUpTask, FollowUpTaskType } from '@/lib/types';

export const FOLLOWUP_METHOD_VERSION = 'fc-followup-v1';

/** Furthest ahead a task may be scheduled: two years, matching F19 retention. */
export const MAX_DUE_DAYS = 730;

export const FollowUpInputSchema = z
  .object({
    taskType: z.enum(FOLLOW_UP_TYPE_CODES as unknown as [string, ...string[]]),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    hospitalId: z.string().min(1).max(120).nullable().optional(),
    departmentId: z.string().min(1).max(120).nullable().optional(),
    careContextId: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();

export type FollowUpInput = z.infer<typeof FollowUpInputSchema>;

export function taskLabel(type: FollowUpTaskType): string {
  return FOLLOW_UP_TASK_TYPES.find((t) => t.code === type)?.label ?? type;
}

/** Neutral, logistics-only phrasing. Reviewed as copy, not generated. */
const TASK_PROMPTS: Record<FollowUpTaskType, string> = {
  collect_report: 'Collect a report from the hospital',
  book_followup: 'Book the follow-up visit you were told about',
  book_referral: 'Book the appointment you were referred for',
  collect_medicines: 'Collect medicines from the pharmacy',
  submit_documents: 'Take documents to the hospital',
};

export function taskPrompt(type: FollowUpTaskType): string {
  return TASK_PROMPTS[type];
}

export function validateDueDate(
  dueDate: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; message: string } {
  const due = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return { ok: false, message: 'That date is not valid.' };
  const days = (due.getTime() - now.getTime()) / 86_400_000;
  if (days < -1) return { ok: false, message: 'Pick a date that has not already passed.' };
  if (days > MAX_DUE_DAYS) {
    return { ok: false, message: 'Pick a date within the next two years.' };
  }
  return { ok: true };
}

export function isOverdue(task: FollowUpTask, now: Date = new Date()): boolean {
  if (task.status !== 'open') return false;
  return new Date(`${task.dueDate}T23:59:59Z`).getTime() < now.getTime();
}

export function daysUntil(task: FollowUpTask, now: Date = new Date()): number {
  const due = new Date(`${task.dueDate}T00:00:00Z`).getTime();
  return Math.round((due - now.getTime()) / 86_400_000);
}

export interface GroupedTasks {
  overdue: FollowUpTask[];
  thisWeek: FollowUpTask[];
  later: FollowUpTask[];
  closed: FollowUpTask[];
}

export function groupTasks(tasks: FollowUpTask[], now: Date = new Date()): GroupedTasks {
  const g: GroupedTasks = { overdue: [], thisWeek: [], later: [], closed: [] };
  for (const t of tasks) {
    if (t.status !== 'open') { g.closed.push(t); continue; }
    if (isOverdue(t, now)) { g.overdue.push(t); continue; }
    if (daysUntil(t, now) <= 7) { g.thisWeek.push(t); continue; }
    g.later.push(t);
  }
  const byDate = (a: FollowUpTask, b: FollowUpTask) => a.dueDate.localeCompare(b.dueDate);
  g.overdue.sort(byDate); g.thisWeek.sort(byDate); g.later.sort(byDate);
  return g;
}

/** Shown once, above the list. States the boundary plainly. */
export const FOLLOWUP_NOTICE =
  'These are reminders you set yourself. FlowCare does not know what your ' +
  'doctor told you and never adds tasks on its own. Nothing here is medical advice.';
