import Link from 'next/link';
import { FlowCareMark } from '@/components/Brand';
import type { HospitalActor, HospitalPermission } from '@/lib/auth/hospital';

/**
 * Chrome for the hospital portal.
 *
 * Visually a FlowCare product — same teal, same type, same cards — but laid
 * out as an operations console rather than a discovery page: persistent left
 * rail, dense tables, no marketing. Reception staff look at this all day.
 *
 * Navigation is filtered by permission. That is presentation only; every page
 * and every route re-checks server-side, because a hidden link has never
 * stopped anyone typing a URL.
 */
interface NavItem {
  href: string;
  label: string;
  needs?: HospitalPermission;
  /**
   * Built and reachable. Unbuilt entries are shown greyed rather than
   * linked: a sidebar that navigates to a 404 reads as a broken product,
   * and silently hiding them would misrepresent how finished this is.
   */
  ready?: boolean;
}

const NAV: NavItem[] = [
  { href: '/hospital', label: 'Dashboard', ready: true },
  { href: '/hospital/appointments', label: 'Appointments', needs: 'appointments:read', ready: true },
  { href: '/hospital/care-access', label: 'Care access', needs: 'appointments:read', ready: true },
  { href: '/hospital/operations', label: 'Operations', needs: 'structure:manage', ready: true },
  { href: '/hospital/messages', label: 'Messages', needs: 'appointments:read', ready: true },
  { href: '/hospital/queue', label: 'Queue', needs: 'queue:read', ready: true },
  { href: '/hospital/patients', label: 'Patients', needs: 'appointments:read', ready: true },
  { href: '/hospital/reviews', label: 'Reviews', needs: 'reviews:moderate', ready: true },
  { href: '/hospital/analytics', label: 'Analytics', needs: 'appointments:read', ready: true },
  { href: '/hospital/profile', label: 'Hospital profile', needs: 'facts:manage', ready: true },
  { href: '/hospital/staff', label: 'Staff', needs: 'memberships:manage', ready: true },
];

export function HospitalShell({
  actor,
  hospitalName,
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  actor: HospitalActor;
  hospitalName: string;
  active: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const items = NAV.filter((n) => !n.needs || actor.permissions.includes(n.needs));

  return (
    <div className="min-h-screen bg-ink-50 md:flex">
      <aside className="shrink-0 border-b border-ink-200 bg-white md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <FlowCareMark size={26} className="text-brand-600" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink-900">FlowCare</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
              Hospital portal
            </p>
          </div>
        </div>

        <div className="border-y border-ink-200 bg-ink-50 px-4 py-2">
          <p className="truncate text-xs font-semibold text-ink-800" title={hospitalName}>
            {hospitalName}
          </p>
          <p className="text-[11px] text-ink-500">
            {actor.user.name} · {actor.permissions.includes('memberships:manage') ? 'Manager' : 'Staff'}
          </p>
        </div>

        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
          {items.map((n) => {
            const on = n.href === '/hospital' ? active === '/hospital' : active.startsWith(n.href);
            if (!n.ready) {
              return (
                <span
                  key={n.href}
                  aria-disabled="true"
                  title="Not built yet"
                  className="flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink-300"
                >
                  {n.label}
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-400">
                    Soon
                  </span>
                </span>
              );
            }
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? 'page' : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  on ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden border-t border-ink-200 p-2 md:block">
          <Link
            href="/hospitals"
            className="block rounded-lg px-3 py-2 text-xs font-semibold text-ink-500 hover:bg-ink-100"
          >
            ← Patient view
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="border-b border-ink-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-ink-900">{title}</h1>
              {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
            </div>
            {actions}
          </div>
        </header>
        <div className="p-5">{children}</div>
      </main>
    </div>
  );
}

/** Dense metric tile. `hint` carries the caveat when a number needs one. */
export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warn' | 'good' | 'muted';
}) {
  const colour = {
    default: 'text-ink-900',
    warn: 'text-amber-700',
    good: 'text-brand-700',
    muted: 'text-ink-400',
  }[tone];
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${colour}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * Shown instead of a number when the underlying events do not exist.
 *
 * A zero and "we have not recorded this yet" mean different things, and
 * printing 0 for the second is how a dashboard starts lying.
 */
export function NoData({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-ink-700">Not enough data yet</p>
      <p className="mt-1 text-xs text-ink-500">{what}</p>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    requested: 'bg-amber-100 text-amber-900',
    reschedule_proposed: 'bg-amber-100 text-amber-900',
    booked: 'bg-brand-100 text-brand-800',
    checked_in: 'bg-brand-100 text-brand-800',
    in_progress: 'bg-sky-100 text-sky-900',
    completed: 'bg-emerald-100 text-emerald-900',
    cancelled: 'bg-ink-100 text-ink-600',
    rejected: 'bg-ink-100 text-ink-600',
    no_show: 'bg-ink-100 text-ink-600',
  };
  const label: Record<string, string> = {
    requested: 'Pending', reschedule_proposed: 'Awaiting patient', booked: 'Confirmed',
    checked_in: 'Checked in', in_progress: 'In consultation', completed: 'Completed',
    cancelled: 'Cancelled', rejected: 'Declined', no_show: 'Not attended',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${map[status] ?? 'bg-ink-100 text-ink-600'}`}>
      {label[status] ?? status}
    </span>
  );
}
