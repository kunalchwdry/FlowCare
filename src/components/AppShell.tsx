'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  IconCalendar, IconCompare, IconHeart, IconList, IconMap, IconSearch, IconSparkles,
} from './Icons';
import { FlowCareLogo } from '@/components/Brand';

const NAV = [
  { href: '/hospitals', label: 'Discover', Icon: IconSearch },
  { href: '/hospitals/map', label: 'Map', Icon: IconMap },
  { href: '/assistant', label: 'Assistant', Icon: IconSparkles },
  { href: '/hospitals/saved', label: 'Saved', Icon: IconHeart },
  { href: '/appointments', label: 'Visits', Icon: IconCalendar },
  { href: '/care', label: 'Care hub', Icon: IconHeart },
];

/** Secondary links: account + keys live in the header, not the bottom bar. */
const ACCOUNT_NAV = [
  { href: '/account', label: 'Account' },
  { href: '/settings', label: 'AI keys' },
];

interface Config {
  demoMode: boolean;
  liveReads?: boolean;
  live?: { hospitals: number; bookable: number } | null;
  googleMaps: { serverConfigured: boolean; browserMapKeyPresent: boolean };
  ai: { anyProviderConfigured: boolean };
  demoAccount?: string | null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((j) => setConfig(j.data)).catch(() => {});
  }, []);

  const active = (href: string) =>
    href === '/hospitals' ? pathname === '/hospitals' : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen flex-col">
      {config?.liveReads
        ? <LiveDataBanner config={config} />
        : config?.demoMode && <DemoBanner config={config} />}

      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <FlowCareLogo size="sm" href="/" className="shrink-0" />

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {/* primary destinations */}
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  active(href) ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
                }`}
              >
                <Icon width={17} height={17} />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {ACCOUNT_NAV.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hidden lg:inline-flex whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50"
              >
                {l.label}
              </Link>
            ))}
            <Link href="/hospitals/compare" className="hidden md:inline-flex fc-btn-secondary !px-3 !py-2 !min-h-[38px] text-xs">
              <IconCompare width={16} height={16} /> Compare
            </Link>
            <AccountSwitch demoMode={Boolean(config?.demoMode)} current={config?.demoAccount ?? 'signout'} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-4 md:pb-10">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-5">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? 'page' : undefined}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                active(href) ? 'text-brand-700' : 'text-ink-500'
              }`}
            >
              <Icon width={20} height={20} />
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <footer className="hidden border-t border-ink-200 bg-white px-4 py-6 md:block">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-500">
          <span className="font-semibold text-ink-700">FlowCare</span>
          <span>Outpatient discovery &amp; appointments</span>
          <span className="ml-auto">
            Place data, ratings and reviews sourced from Google are attributed to{' '}
            <span className="font-semibold text-ink-700">Google Maps</span> and are not verified by FlowCare.
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * Shown when hospitals come from the live Supabase project. It must name what
 * is real AND what is not, in the same breath: the facility record is a real
 * row, an appointment slot is not. Saying only the flattering half would be
 * the dishonest option.
 */
function LiveDataBanner({ config }: { config: Config }) {
  const n = config.live?.hospitals;
  return (
    <div className="bg-sky-100 px-4 py-2 text-center text-[12px] font-medium text-sky-950">
      <strong>Live database.</strong>{' '}
      {n ? `${n} hospitals` : 'Hospitals'}, services, accessibility notes, arrival packs and
      support channels are read from the live Supabase project over RLS.{' '}
      <strong>Appointment slots are generated locally</strong> for the two records the database
      itself labels <span className="font-mono">[TEST]</span> — the live project has no sessions
      table — and sign-in uses demo accounts. No FlowCare reviews exist yet, so no ratings are shown.
      {!config.googleMaps.serverConfigured && ' Google Maps is not configured, so no Google ratings or photos are shown.'}
      {!config.ai.anyProviderConfigured && ' No AI provider is configured, so the assistant uses FlowCare\'s deterministic parser.'}
    </div>
  );
}

function DemoBanner({ config }: { config: Config }) {
  return (
    <div className="bg-amber-100 px-4 py-2 text-center text-[12px] font-medium text-amber-900">
      <strong>Demo data.</strong> Supabase is not configured, so hospitals, sessions, appointments and reviews are
      synthetic records generated locally — they are not real hospitals or real patient feedback.
      {!config.googleMaps.serverConfigured && ' Google Maps is not configured, so no Google ratings or photos are shown.'}
      {!config.ai.anyProviderConfigured && ' No AI provider is configured, so the assistant uses FlowCare\'s deterministic parser.'}
    </div>
  );
}

function AccountSwitch({ demoMode, current }: { demoMode: boolean; current: string }) {
  const [account, setAccount] = useState(current);
  // fc_demo_user is httpOnly, so the browser cannot read it. /api/config
  // reports the active account name; mirror it so the switch shows who is
  // actually signed in after a reload instead of resetting to "Signed out".
  useEffect(() => { setAccount(current); }, [current]);
  if (!demoMode) {
    return (
      <Link href="/appointments" className="fc-btn-primary !px-3 !py-2 !min-h-[38px] text-xs">
        My visits
      </Link>
    );
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-500">
      <span className="hidden sm:inline">Demo account</span>
      <select
        aria-label="Switch demo account"
        className="rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-xs font-semibold text-ink-800"
        value={account}
        onChange={async (e) => {
          setAccount(e.target.value);
          await fetch('/api/demo-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account: e.target.value }),
          });
          window.location.reload();
        }}
      >
        <option value="signout">Signed out</option>
        <option value="patient">Patient</option>
        <option value="patient2">Patient 2</option>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </select>
    </label>
  );
}

export { IconList };
