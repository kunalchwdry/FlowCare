import { requireHospitalPermission, PERMISSION_LABEL, ROLE_PRESETS, HOSPITAL_PERMISSIONS } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, Stat, NoData } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { listStaff, listMembershipEvents } from '@/lib/hospital/portalData';
import type { HospitalPermission } from '@/lib/auth/hospital';
import { formatDate, formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff — FlowCare hospital portal' };

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-900',
  pending: 'bg-amber-100 text-amber-900',
  revoked: 'bg-ink-100 text-ink-600',
};

/**
 * Who has access to this hospital, and what each of them may do.
 *
 * Scoped by the caller's own membership. There is no hospital selector,
 * because there is no code path that would let an administrator here see
 * another hospital's roster — RLS on `memberships` returns the full list
 * only to someone holding `memberships:manage` at that specific hospital.
 *
 * Granting and revoking are not wired to this screen yet. Doing it properly
 * means going through `manage_membership`, the SECURITY DEFINER RPC that
 * already records who approved whom and bumps the row version; a direct
 * table write from here would bypass that trail. Until then this is the
 * honest roster, and changes are made by an operator.
 */
export default async function HospitalStaff() {
  const gate = await requireHospitalPermission('memberships:manage', '/hospital/staff');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden')
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/staff" title="Staff" />;

  const { actor } = gate;
  const repo = await getRepo();
  const [hospital, staff, events] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    listStaff(actor.hospitalId),
    listMembershipEvents(actor.hospitalId),
  ]);

  const active = staff.filter((s) => s.status === 'active');
  const pending = staff.filter((s) => s.status === 'pending');
  const admins = active.filter((s) => s.role === 'admin');

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/staff"
      title="Staff"
      subtitle="Everyone with access to this hospital, and the permissions they hold."
    >
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active staff" value={active.length} />
        <Stat label="Awaiting approval" value={pending.length} tone={pending.length ? 'warn' : 'default'} />
        <Stat label="Managers" value={admins.length} hint="Hold memberships:manage" />
      </section>

      {admins.length === 1 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            Only one account can manage staff here. If it is lost, nobody at this hospital can
            grant access and an operator has to step in — worth giving a second person
            <span className="font-mono"> memberships:manage</span>.
          </p>
        </div>
      )}

      {staff.length === 0 ? (
        <div className="mt-4"><NoData what="No memberships are recorded for this hospital." /></div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Account</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Role</th>
                <th className="px-4 py-2 font-semibold">Permissions</th>
                <th className="px-4 py-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {staff.map((s) => (
                <tr key={s.userId} className="align-top">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-ink-700">{s.userId.slice(0, 8)}…</span>
                    {s.userId === actor.user.id && (
                      <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-800">
                        YOU
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s.status] ?? STATUS_STYLE.revoked}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink-800">{s.role}</td>
                  <td className="px-4 py-3">
                    {s.permissions.length === 0 ? (
                      <span className="text-xs text-ink-400">none</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {s.permissions.map((p) => (
                          <span key={p} className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-700">
                            {p}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {s.updatedAt
                      ? formatDate(s.updatedAt)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-900">Granting access is not wired to this screen yet</p>
        <p className="mt-1 text-sm text-amber-900">
          Changes have to go through <span className="font-mono">manage_membership</span>, which
          records who approved whom and bumps the row version. Writing to the table directly from
          here would skip that trail, so for now an operator makes the change.
        </p>
      </div>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Permission reference</h2>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-800">What each permission allows</p>
          <ul className="mt-2 space-y-1">
            {HOSPITAL_PERMISSIONS.map((p: HospitalPermission) => (
              <li key={p} className="text-xs text-ink-600">
                <span className="font-mono text-ink-800">{p}</span> — {PERMISSION_LABEL[p]}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-800">Common combinations</p>
          <p className="mt-1 text-xs text-ink-500">
            Presets are a convenience for filling in the list. Nothing reads the preset name —
            the stored permissions are what authorise anything.
          </p>
          <ul className="mt-2 space-y-2">
            {ROLE_PRESETS.map((r) => (
              <li key={r.id}>
                <p className="text-xs font-semibold text-ink-800">{r.label}</p>
                <p className="text-xs text-ink-500">{r.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Membership history</h2>
      {events.length === 0 ? (
        <div className="mt-2"><NoData what="Changes to staff access will be listed here as they happen." /></div>
      ) : (
        <ul className="mt-2 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white p-3 text-sm">
              <span className="font-semibold text-ink-800">{e.action.replace(/_/g, ' ')}</span>
              <span className="font-mono text-xs text-ink-500">
                subject {e.subjectId ? `${e.subjectId.slice(0, 8)}…` : '—'}
              </span>
              <span className="ml-auto text-xs text-ink-500">
                {formatDateTime(e.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </HospitalShell>
  );
}
