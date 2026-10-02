import Link from 'next/link';
import type { Metadata } from 'next';
import { getRepo } from '@/lib/data';
import { requirePatientPage } from '@/lib/auth/guards';
import { EmptyState } from '@/components/States';
import { FlowCareMark } from '@/components/Brand';
import {
  IconCalendar, IconCompare, IconHeart, IconSearch, IconSparkles,
} from '@/components/Icons';
import type { Appointment, Hospital } from '@/lib/types';
import { formatDateTime } from '@/lib/time';

export const metadata: Metadata = { title: 'Your dashboard — FlowCare' };
export const dynamic = 'force-dynamic';

const ACTIVE: Appointment['status'][] = [
  'requested', 'booked', 'reschedule_proposed', 'checked_in', 'in_progress',
];

const STATUS_STYLE: Record<Appointment['status'], { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'fc-pill-warn' },
  reschedule_proposed: { label: 'New time proposed', cls: 'fc-pill-warn' },
  rejected: { label: 'Declined', cls: 'fc-pill-muted' },
  booked: { label: 'Confirmed', cls: 'fc-pill-brand' },
  checked_in: { label: 'Checked in', cls: 'fc-pill-brand' },
  in_progress: { label: 'In consultation', cls: 'fc-pill-success' },
  completed: { label: 'Completed', cls: 'fc-pill-success' },
  cancelled: { label: 'Cancelled', cls: 'fc-pill-muted' },
  no_show: { label: 'Missed', cls: 'fc-pill-muted' },
};

function greeting(d = new Date()): string {
  const h = Number(d.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function when(iso: string): string {
  return formatDateTime(iso);
}

const QUICK = [
  { href: '/hospitals', label: 'Find a hospital', Icon: IconSearch },
  { href: '/appointments/new', label: 'Book appointment', Icon: IconCalendar },
  { href: '/hospitals/compare', label: 'Compare', Icon: IconCompare },
  { href: '/assistant', label: 'Ask the assistant', Icon: IconSparkles },
];

export default async function PatientDashboard() {
  const user = await requirePatientPage();
  const repo = await getRepo();

  const [appointments, hospitals, favorites] = await Promise.all([
    repo.listAppointments({ patientId: user.id }),
    repo.listHospitals(),
    repo.listFavorites(user.id).catch(() => []),
  ]);

  const byId = new Map<string, Hospital>(hospitals.map((h) => [h.id, h]));
  const sorted = [...appointments].sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
  const upcoming = sorted.filter((a) => ACTIVE.includes(a.status)).reverse();
  const current = upcoming[0] ?? null;
  const past = sorted.filter((a) => !ACTIVE.includes(a.status)).slice(0, 5);
  const completedCount = appointments.filter((a) => a.status === 'completed').length;

  // "Recommended" here means nothing more than nearby and published. There is
  // no hidden ranking of clinical quality, and the copy says so.
  const recommended = hospitals.slice(0, 3);
  const firstName = user.name.split(/\s+/)[0] || 'there';

  return (
    <div className="space-y-5 py-2">
      {/* ------------------------------------------------ greeting + quick */}
      <section className="fc-card animate-fade-up overflow-hidden">
        <div className="relative px-6 py-7 sm:px-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-50 blur-2xl"
          />
          <div className="relative">
            <p className="fc-eyebrow">Patient dashboard</p>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-2 text-sm text-ink-600">
              {current
                ? 'You have an appointment in progress. Everything about it is below.'
                : 'Nothing scheduled right now. Start by finding a hospital.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {QUICK.map(({ href, label, Icon }) => (
                <Link key={href} href={href} className="fc-btn-secondary text-sm">
                  <Icon width={16} height={16} /> {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- summary */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Upcoming', value: upcoming.length, hint: 'requested or confirmed' },
          { label: 'Completed visits', value: completedCount, hint: 'you can review these' },
          { label: 'Saved hospitals', value: Array.isArray(favorites) ? favorites.length : 0, hint: 'private to you' },
          { label: 'Hospitals listed', value: hospitals.length, hint: 'published in FlowCare' },
        ].map((s) => (
          <div key={s.label} className="fc-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{s.label}</p>
            <p className="mt-2 text-2xl font-extrabold text-ink-900">{s.value}</p>
            <p className="mt-0.5 text-[11px] text-ink-500">{s.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------- current appointment */}
        <section className="space-y-4 lg:col-span-2">
          <div className="fc-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="fc-h2">Current appointment</h2>
              {upcoming.length > 1 && (
                <Link href="/appointments" className="text-xs font-semibold text-brand-700 hover:underline">
                  View all {upcoming.length}
                </Link>
              )}
            </div>

            {current ? (
              <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-ink-900">
                      {byId.get(current.hospitalId)?.name ?? 'Hospital'}
                    </p>
                    <p className="mt-1 text-sm text-ink-600">{when(current.scheduledFor)}</p>
                  </div>
                  <span className={STATUS_STYLE[current.status].cls}>
                    {STATUS_STYLE[current.status].label}
                  </span>
                </div>

                {current.status === 'requested' && (
                  <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs leading-relaxed text-ink-600">
                    The hospital has not confirmed this yet. Keep an eye on it before you travel.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/appointments/${current.id}`} className="fc-btn-primary text-sm">
                    View details
                  </Link>
                  <Link href={`/visit/${current.id}`} className="fc-btn-secondary text-sm">
                    Arrival guide
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                title="No appointment scheduled"
                description="When you request a slot it appears here, with the queue position once you check in."
                primary={{ label: 'Find a hospital', href: '/hospitals' }}
                secondary={{ label: 'Book appointment', href: '/appointments/new' }}
              />
            )}
          </div>

          {/* --------------------------------------------- recent activity */}
          <div className="fc-card p-5">
            <h2 className="fc-h2">Recent activity</h2>
            {past.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {past.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/appointments/${a.id}`}
                      className="flex items-center gap-3 rounded-xl border border-ink-200 p-3 transition-colors hover:border-ink-300 hover:bg-ink-50"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-500">
                        <IconCalendar width={17} height={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-900">
                          {byId.get(a.hospitalId)?.name ?? 'Hospital'}
                        </span>
                        <span className="block text-xs text-ink-500">{when(a.scheduledFor)}</span>
                      </span>
                      <span className={STATUS_STYLE[a.status].cls}>{STATUS_STYLE[a.status].label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                title="Nothing here yet"
                description="Past visits, cancellations and completed consultations will show up here."
              />
            )}
          </div>
        </section>

        {/* ------------------------------------------------ queue + recos */}
        <section className="space-y-4">
          <div className="fc-card p-5">
            <h2 className="fc-h2">Queue tracking</h2>
            {current && (current.status === 'checked_in' || current.status === 'in_progress') ? (
              <>
                <p className="mt-3 text-sm text-ink-600">You are checked in. Follow your position live.</p>
                <Link href={`/appointments/${current.id}`} className="fc-btn-primary mt-4 w-full text-sm">
                  Open queue tracker
                </Link>
              </>
            ) : (
              <div className="mt-3 rounded-xl bg-ink-50 p-4 text-sm leading-relaxed text-ink-600">
                <FlowCareMark size={22} className="text-ink-300" />
                <p className="mt-2.5">
                  Your live position appears once you check in at the hospital — and only where
                  the hospital is actually reporting its queue. FlowCare will not invent a number.
                </p>
              </div>
            )}
          </div>

          <div className="fc-card p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="fc-h2">Hospitals to explore</h2>
              <Link href="/hospitals" className="text-xs font-semibold text-brand-700 hover:underline">
                See all
              </Link>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
              Listed facilities, not a quality ranking.
            </p>
            {recommended.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {recommended.map((h) => (
                  <li key={h.id}>
                    <Link
                      href={`/hospitals/${h.slug}`}
                      className="flex items-center gap-3 rounded-xl border border-ink-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                        <IconHeart width={16} height={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink-900">{h.name}</span>
                        <span className="block truncate text-xs text-ink-500">{h.city ?? h.addressLine}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No hospitals listed yet" />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
