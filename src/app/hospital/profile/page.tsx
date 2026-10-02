import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, Stat, NoData } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { freshnessOf } from '@/lib/provenance';
import type { FactField } from '@/lib/provenance';
import type { Provenance } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hospital profile — FlowCare hospital portal' };

const FRESHNESS_STYLE: Record<string, string> = {
  fresh: 'bg-emerald-100 text-emerald-900',
  ageing: 'bg-amber-100 text-amber-900',
  stale: 'bg-rose-100 text-rose-900',
  unverified: 'bg-ink-100 text-ink-600',
  live: 'bg-sky-100 text-sky-900',
};

/**
 * Renders the real freshness view rather than a date.
 *
 * `freshnessOf` already decides whether a fact is fresh, ageing, stale or
 * never verified, using a per-field TTL. Re-deriving that here would let
 * the portal and the patient-facing pages drift apart and disagree about
 * the same fact.
 */
function Freshness({ provenance, field }: { provenance: Provenance; field: FactField }) {
  const v = freshnessOf(provenance, field);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${FRESHNESS_STYLE[v.state] ?? FRESHNESS_STYLE.unverified}`}>
        {v.label}
      </span>
      {v.caution && <span className="text-[11px] text-ink-500">{v.caution}</span>}
    </span>
  );
}

/**
 * The hospital's published information, with its provenance.
 *
 * Read-only, and that is a deliberate stopping point rather than an
 * unfinished one. FlowCare's claim is that every fact on a patient's screen
 * carries a source, a verifier and a date. An edit box that writes a new
 * value and leaves those three untouched would quietly convert "somebody at
 * the hospital typed this" into "FlowCare verified this" — the single thing
 * the provenance model exists to prevent.
 *
 * Submitting a change therefore belongs in the existing corrections
 * workflow, where a reviewer is recorded. Until that is wired to this
 * screen, showing the current state and its freshness honestly is worth
 * more than an edit form that lies about verification.
 */
export default async function HospitalProfile() {
  const gate = await requireHospitalPermission('facts:manage', '/hospital/profile');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden')
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/profile" title="Hospital profile" />;

  const { actor } = gate;
  const repo = await getRepo();
  const [hospital, facts] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.getFacilityFacts(actor.hospitalId),
  ]);

  const basics: [string, string | null | undefined][] = [
    ['Name', hospital?.name],
    ['City', hospital?.city],
    ['Address', hospital?.addressLine],
    ['Phone', hospital?.phone],
    ['Website', hospital?.website],
  ];

  const neverVerified = facts.serviceVerifications.filter((s) => !s.provenance.verifiedAt).length;

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/profile"
      title="Hospital profile"
      subtitle="What patients see about you, and how fresh each fact is."
    >
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Services listed" value={facts.serviceVerifications.length} />
        <Stat label="Accessibility notes" value={facts.accessibilityComponents.length} />
        <Stat
          label="Never verified"
          value={neverVerified}
          tone={neverVerified ? 'warn' : 'default'}
          hint="Shown to patients as unverified"
        />
      </section>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-900">Editing is not live on this screen yet</p>
        <p className="mt-1 text-sm text-amber-900">
          A change has to carry a source, a verifier and a date, or typing a new value would
          silently turn it into a verified fact. Edits belong in the corrections workflow so a
          reviewer is recorded — that connection is not built yet, and an edit box without it
          would misrepresent what FlowCare has actually checked.
        </p>
      </div>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Basic information</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table className="w-full min-w-[620px] text-left text-sm">
          <tbody className="divide-y divide-ink-100">
            {basics.map(([label, value]) => (
              <tr key={label}>
                <td className="w-40 px-4 py-3 font-semibold text-ink-700">{label}</td>
                <td className="px-4 py-3 text-ink-800">
                  {value || <span className="text-ink-400">Not recorded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">
        Services and their provenance
      </h2>
      {facts.serviceVerifications.length === 0 ? (
        <div className="mt-2"><NoData what="No services are recorded for this hospital yet." /></div>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Service</th>
                <th className="px-4 py-2 font-semibold">How it was established</th>
                <th className="px-4 py-2 font-semibold">Verified by</th>
                <th className="px-4 py-2 font-semibold">Freshness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {facts.serviceVerifications.slice(0, 40).map((s, i) => (
                <tr key={`${s.serviceSlug}-${i}`} className="align-top">
                  <td className="px-4 py-3 text-ink-800">{s.serviceSlug}</td>
                  <td className="px-4 py-3 text-xs text-ink-600">{s.method.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-xs text-ink-600">{s.provenance.verifiedByRole ?? '—'}</td>
                  <td className="px-4 py-3"><Freshness provenance={s.provenance} field="services" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {facts.serviceVerifications.length > 40 && (
            <p className="px-4 py-2 text-xs text-ink-500">
              Showing the first 40 of {facts.serviceVerifications.length}.
            </p>
          )}
        </div>
      )}

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Accessibility</h2>
      {facts.accessibilityComponents.length === 0 ? (
        <div className="mt-2"><NoData what="No accessibility information has been recorded or verified yet." /></div>
      ) : (
        <ul className="mt-2 space-y-2">
          {facts.accessibilityComponents.map((a, i) => (
            <li key={`${a.componentCode}-${i}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white p-3">
              <span className="text-sm font-semibold text-ink-800">{a.componentCode.replace(/_/g, ' ')}</span>
              <span className="text-sm text-ink-600">{a.status}</span>
              {a.note && <span className="text-xs text-ink-500">{a.note}</span>}
              <span className="ml-auto"><Freshness provenance={a.provenance} field="accessibility" /></span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-ink-500">
        Anything never verified is shown to patients as unverified rather than presented as fact.
        That is the point of the model: an absent check is stated, not hidden.
      </p>
    </HospitalShell>
  );
}
