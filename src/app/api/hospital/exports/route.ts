import { NextRequest, NextResponse } from 'next/server';
import type { QueueEntry } from '@/lib/careAccess/types';
import * as XLSX from 'xlsx';
import { getRepo } from '@/lib/data';
import { hospitalActorFromSession } from '@/lib/auth/hospital';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csv(rows: Array<Record<string, string | number | null>>): string {
  if (!rows.length) return 'queue_id,status,department_id,slot_id,estimated_slot_at,updated_at\n';
  const keys = Object.keys(rows[0]);
  const quote = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [keys.join(','), ...rows.map((row) => keys.map((key) => quote(row[key])).join(','))].join('\n') + '\n';
}

export async function GET(req: NextRequest) {
  try {
    const actor = await hospitalActorFromSession();
    if (!actor) return fail(401, 'Sign in to the hospital portal.');
    if (!actor.permissions.includes('exports:read')) return fail(403, 'Your hospital permission does not allow exports.');
    const format = req.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
    const status = (req.nextUrl.searchParams.get('status') || undefined) as QueueEntry['status'] | undefined;
    const departmentId = req.nextUrl.searchParams.get('departmentId') ?? undefined;
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const includePhone = req.nextUrl.searchParams.get('includePhone') === '1' && actor.permissions.includes('queue:manage');
    const repo = await getRepo();
    const result = await repo.listQueueEntries({ hospitalId: actor.hospitalId, departmentId, status: status ?? undefined });
    const requests = includePhone ? await repo.listCareRequests({ hospitalId: actor.hospitalId }) : [];
    const phones = new Map(requests.map((r) => [r.id, r.patientPhone ?? null]));
    const rows = result.entries
      .filter((entry) => !from || !entry.estimatedSlotAt || entry.estimatedSlotAt >= from)
      .filter((entry) => !to || !entry.estimatedSlotAt || entry.estimatedSlotAt <= to)
      .map((entry) => ({
        queue_id: entry.queueId, status: entry.status, queue_type: entry.queueType,
        department_id: entry.departmentId, slot_id: entry.slotId, position: entry.position,
        estimated_slot_at: entry.estimatedSlotAt, updated_at: entry.lastUpdatedAt,
        ...(includePhone ? { patient_phone: phones.get(entry.careRequestId ?? '') ?? null } : {}),
      }));
    await repo.recordAuditEvent({ actorId: actor.user.id, actorRole: actor.user.role, action: 'operational_export', entity: 'queue_entries', entityId: actor.hospitalId, metadata: { format, rowCount: rows.length, phoneIncluded: includePhone, filtersApplied: Boolean(status || departmentId || from || to) } });
    if (format === 'csv') {
      return new NextResponse(csv(rows), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flowcare-queue-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
    }
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Queue export');
    const data = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return new NextResponse(data as unknown as BodyInit, { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="flowcare-queue-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return handleError(e); }
}
