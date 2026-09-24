'use client';

/**
 * The patient-owned corner of FlowCare: care contexts (F3), visit history
 * (F19) and follow-up reminders (F20).
 *
 * Everything here is owner-scoped and, by design, thin. There is no notes
 * field, no condition, no relationship, no document upload. §9.1 puts those
 * out of scope, and the honest answer for medical records is ABDM, which
 * this page says in as many words rather than quietly implying FlowCare is
 * the right place to keep them.
 */
import { useCallback, useEffect, useState } from 'react';
import { IconCalendar, IconCheck, IconInfo, IconPin } from './Icons';
import { ACCESSIBILITY_COMPONENTS, FOLLOW_UP_TASK_TYPES, TRANSPORT_MODES } from '@/lib/journey/vocab';
import { LANGUAGE_NAMES } from '@/lib/journey/factsView';
import type { CareContext, FollowUpTask, VisitRecord } from '@/lib/types';

interface HospitalLite { id: string; name: string }
type Task = FollowUpTask & { hospitalName: string | null };
type Visit = VisitRecord & { hospitalName: string | null };

const MODE_LABELS: Record<string, string> = {
  walk: 'Walking', transit: 'Bus / train', drive: 'Car / auto',
};

export function CareHub() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [contexts, setContexts] = useState<CareContext[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hospitals, setHospitals] = useState<HospitalLite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [retentionMonths, setRetentionMonths] = useState(24);

  const reload = useCallback(async () => {
    const [c, v, t] = await Promise.all([
      fetch('/api/care-contexts').then((r) => r.json()).catch(() => null),
      fetch('/api/visits').then((r) => r.json()).catch(() => null),
      fetch('/api/followups').then((r) => r.json()).catch(() => null),
    ]);
    if (!c?.ok) { setAuthed(false); return; }
    setAuthed(true);
    setContexts(c.data.careContexts ?? []);
    if (v?.ok) { setVisits(v.data.visits ?? []); setRetentionMonths(v.data.retentionMonths ?? 24); }
    if (t?.ok) { setTasks(t.data.tasks ?? []); setNotice(t.data.notice ?? null); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    fetch('/api/hospitals/search?pageSize=50')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setHospitals(
            (j.data.results ?? []).map((r: { hospital: HospitalLite }) => ({
              id: r.hospital.id, name: r.hospital.name,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  if (authed === false) {
    return (
      <div className="fc-card p-6 text-center">
        <h1 className="text-lg font-bold">Sign in to use your care hub</h1>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
          Care contexts, visit history and reminders are private to your
          account. Nobody else — including hospital staff — can see them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <header>
        <h1 className="text-xl font-extrabold text-ink-900">Your care hub</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Private to you. FlowCare keeps where and when — never why.
        </p>
      </header>

      <ContextsSection contexts={contexts} onChange={reload} />
      <FollowUpSection tasks={tasks} hospitals={hospitals} contexts={contexts} notice={notice} onChange={reload} />
      <VisitsSection visits={visits} hospitals={hospitals} contexts={contexts} retentionMonths={retentionMonths} onChange={reload} />

      <section className="fc-card bg-ink-50 p-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-600">
          <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
          FlowCare is not a medical record. There is nowhere here to store
          symptoms, diagnoses, prescriptions or reports, and that is deliberate.
          For your health records, use your ABHA account under India&rsquo;s
          Ayushman Bharat Digital Mission.
        </p>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- F3 ---- */

function ContextsSection({ contexts, onChange }: { contexts: CareContext[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [accessibilityPrefs, setAccessibilityPrefs] = useState<string[]>([]);
  const [languagePrefs, setLanguagePrefs] = useState<string[]>([]);
  const [transportMode, setTransportMode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/care-contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        accessibilityPrefs,
        languagePrefs,
        ...(transportMode ? { transportMode } : {}),
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { setError(j.error?.message ?? 'Could not save that.'); return; }
    setLabel(''); setAccessibilityPrefs([]); setLanguagePrefs([]); setTransportMode('');
    setAdding(false);
    onChange();
  }

  async function remove(id: string) {
    await fetch(`/api/care-contexts/${id}`, { method: 'DELETE' });
    onChange();
  }

  return (
    <section className="fc-card p-5">
      <h2 className="text-base font-bold">Who you are searching for</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        Most people who book appointments are booking for someone else. Save
        the things that actually change the answer — step-free access, a
        language, how you travel — and switch between them when you search.
      </p>

      {contexts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {contexts.map((c) => (
            <li key={c.id} className="rounded-xl border border-ink-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-bold text-ink-900">{c.label}</p>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="shrink-0 text-[11px] font-semibold text-ink-500 hover:text-rose-700"
                >
                  Delete
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.accessibilityPrefs.map((a) => (
                  <span key={a} className="fc-pill bg-ink-100 text-ink-700 !text-[10.5px]">
                    {ACCESSIBILITY_COMPONENTS.find((x) => x.code === a)?.label ?? a}
                  </span>
                ))}
                {c.languagePrefs.map((l) => (
                  <span key={l} className="fc-pill bg-ink-100 text-ink-700 !text-[10.5px]">
                    {LANGUAGE_NAMES[l] ?? l}
                  </span>
                ))}
                {c.transportMode && (
                  <span className="fc-pill bg-ink-100 text-ink-700 !text-[10.5px]">
                    {MODE_LABELS[c.transportMode]}
                  </span>
                )}
                {!c.accessibilityPrefs.length && !c.languagePrefs.length && !c.transportMode && (
                  <span className="text-[11px] text-ink-500">No preferences saved</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={submit} className="mt-3 rounded-xl border border-ink-200 p-3">
          <label className="block">
            <span className="fc-label">Call it something you will recognise</span>
            <input
              className="fc-input mt-1"
              maxLength={60}
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Dad, or Weekend visits"
            />
          </label>
          <p className="mt-1 text-[11px] text-ink-500">
            Please do not put health details in the label.
          </p>

          <div className="mt-3">
            <span className="fc-label">Access needs</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ACCESSIBILITY_COMPONENTS.slice(0, 6).map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className={accessibilityPrefs.includes(c.code) ? 'fc-chip-on !py-1 !text-[11px]' : 'fc-chip-off !py-1 !text-[11px]'}
                  onClick={() => toggle(accessibilityPrefs, c.code, setAccessibilityPrefs)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <span className="fc-label">Languages</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                <button
                  key={code}
                  type="button"
                  className={languagePrefs.includes(code) ? 'fc-chip-on !py-1 !text-[11px]' : 'fc-chip-off !py-1 !text-[11px]'}
                  onClick={() => toggle(languagePrefs, code, setLanguagePrefs)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <span className="fc-label">How they usually travel</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TRANSPORT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={transportMode === m ? 'fc-chip-on !py-1 !text-[11px]' : 'fc-chip-off !py-1 !text-[11px]'}
                  onClick={() => setTransportMode(transportMode === m ? '' : m)}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {error && <p role="alert" className="mt-2.5 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button type="submit" className="fc-btn-primary !py-2 !text-xs">Save</button>
            <button type="button" className="fc-btn-secondary !py-2 !text-xs" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="fc-btn-secondary mt-3 !py-2 !text-xs" onClick={() => setAdding(true)}>
          Add someone
        </button>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- F20 ---- */

function FollowUpSection({
  tasks, hospitals, contexts, notice, onChange,
}: {
  tasks: Task[]; hospitals: HospitalLite[]; contexts: CareContext[];
  notice: string | null; onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [taskType, setTaskType] = useState<string>('collect_report');
  const [dueDate, setDueDate] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [careContextId, setCareContextId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskType,
        dueDate,
        ...(hospitalId ? { hospitalId } : {}),
        ...(careContextId ? { careContextId } : {}),
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { setError(j.error?.message ?? 'Could not add that.'); return; }
    setDueDate(''); setHospitalId(''); setCareContextId(''); setAdding(false);
    onChange();
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/followups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    onChange();
  }

  const open = tasks.filter((t) => t.status === 'open');
  const closed = tasks.filter((t) => t.status !== 'open');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="fc-card p-5">
      <h2 className="text-base font-bold">Things to come back for</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        Reports to collect, follow-ups to book. Add them yourself — FlowCare
        does not know what you were told and will not invent a task.
      </p>

      {open.length > 0 && (
        <ul className="mt-3 space-y-2">
          {open.map((t) => {
            const overdue = t.dueDate < today;
            return (
              <li
                key={t.id}
                className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
                  overdue ? 'border-amber-300 bg-amber-50' : 'border-ink-200'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">
                    {FOLLOW_UP_TASK_TYPES.find((x) => x.code === t.taskType)?.label ?? t.taskType}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-600">
                    <IconCalendar width={12} height={12} />
                    {overdue ? 'Was due ' : 'Due '}
                    {new Date(`${t.dueDate}T00:00:00`).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    {t.hospitalName && <> · <IconPin width={12} height={12} /> {t.hospitalName}</>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setStatus(t.id, 'done')}
                    className="fc-btn-secondary !px-2 !py-1 !text-[11px]"
                  >
                    <IconCheck width={12} height={12} /> Done
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(t.id, 'dismissed')}
                    className="text-[11px] font-semibold text-ink-500 hover:text-ink-800"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open.length === 0 && !adding && (
        <p className="mt-3 rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
          Nothing outstanding.
        </p>
      )}

      {adding ? (
        <form onSubmit={submit} className="mt-3 rounded-xl border border-ink-200 p-3">
          <label className="block">
            <span className="fc-label">What do you need to do?</span>
            <select className="fc-input mt-1" value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              {FOLLOW_UP_TASK_TYPES.map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="fc-label">When?</span>
            <input
              type="date"
              className="fc-input mt-1"
              required
              min={today}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>

          <label className="mt-3 block">
            <span className="fc-label">Which hospital? (optional)</span>
            <select className="fc-input mt-1" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
              <option value="">Not specified</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>

          {contexts.length > 0 && (
            <label className="mt-3 block">
              <span className="fc-label">Who for? (optional)</span>
              <select className="fc-input mt-1" value={careContextId} onChange={(e) => setCareContextId(e.target.value)}>
                <option value="">Not specified</option>
                {contexts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          )}

          {error && <p role="alert" className="mt-2.5 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button type="submit" className="fc-btn-primary !py-2 !text-xs">Add reminder</button>
            <button type="button" className="fc-btn-secondary !py-2 !text-xs" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="fc-btn-secondary mt-3 !py-2 !text-xs" onClick={() => setAdding(true)}>
          Add a reminder
        </button>
      )}

      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink-600">
            {closed.length} finished
          </summary>
          <ul className="mt-2 space-y-1">
            {closed.map((t) => (
              <li key={t.id} className="text-xs text-ink-500 line-through">
                {FOLLOW_UP_TASK_TYPES.find((x) => x.code === t.taskType)?.label} · {t.dueDate}
              </li>
            ))}
          </ul>
        </details>
      )}

      {notice && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-600">
          <IconInfo width={13} height={13} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- F19 ---- */

function VisitsSection({
  visits, hospitals, contexts, retentionMonths, onChange,
}: {
  visits: Visit[]; hospitals: HospitalLite[]; contexts: CareContext[];
  retentionMonths: number; onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [hospitalId, setHospitalId] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [careContextId, setCareContextId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hospitalId,
        visitDate,
        ...(careContextId ? { careContextId } : {}),
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { setError(j.error?.message ?? 'Could not save that.'); return; }
    setHospitalId(''); setVisitDate(''); setCareContextId(''); setAdding(false);
    onChange();
  }

  async function remove(id: string) {
    await fetch(`/api/visits/${id}`, { method: 'DELETE' });
    onChange();
  }

  return (
    <section className="fc-card p-5">
      <h2 className="text-base font-bold">Where you have been</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        A plain list of which hospital, which department and when — useful when
        a form asks and you cannot remember. Nothing about why you went.
      </p>

      {visits.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink-100">
          {visits.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-800">
                  {v.hospitalName ?? v.hospitalId}
                </p>
                <p className="text-[11px] text-ink-500">
                  {new Date(`${v.visitDate}T00:00:00`).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(v.id)}
                className="shrink-0 text-[11px] font-semibold text-ink-500 hover:text-rose-700"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
          No visits recorded.
        </p>
      )}

      {adding ? (
        <form onSubmit={submit} className="mt-3 rounded-xl border border-ink-200 p-3">
          <label className="block">
            <span className="fc-label">Which hospital?</span>
            <select className="fc-input mt-1" required value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
              <option value="">Choose…</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="fc-label">When?</span>
            <input
              type="date"
              className="fc-input mt-1"
              required
              max={new Date().toISOString().slice(0, 10)}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </label>

          {contexts.length > 0 && (
            <label className="mt-3 block">
              <span className="fc-label">Who for? (optional)</span>
              <select className="fc-input mt-1" value={careContextId} onChange={(e) => setCareContextId(e.target.value)}>
                <option value="">Not specified</option>
                {contexts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          )}

          {error && <p role="alert" className="mt-2.5 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button type="submit" className="fc-btn-primary !py-2 !text-xs">Save visit</button>
            <button type="button" className="fc-btn-secondary !py-2 !text-xs" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="fc-btn-secondary mt-3 !py-2 !text-xs" onClick={() => setAdding(true)}>
          Record a visit
        </button>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        Visits are deleted automatically after {retentionMonths} months, and you
        can delete any of them now.
      </p>
    </section>
  );
}
