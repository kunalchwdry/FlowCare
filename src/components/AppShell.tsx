'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  IconCalendar, IconCompare, IconHeart, IconList, IconMap, IconMessage, IconSearch, IconSparkles,
} from './Icons';
import { FlowCareLogo } from '@/components/Brand';

const NAV = [
  { href: '/hospitals', label: 'Discover', Icon: IconSearch },
  { href: '/hospitals/map', label: 'Map', Icon: IconMap },
  { href: '/assistant', label: 'Assistant', Icon: IconSparkles },
  { href: '/hospitals/saved', label: 'Saved', Icon: IconHeart },
  { href: '/appointments', label: 'Visits', Icon: IconCalendar },
  { href: '/care-access', label: 'Care access', Icon: IconList },
  { href: '/care', label: 'Care hub', Icon: IconHeart },
];

/** Secondary account link lives in the header, not the bottom bar. */
const ACCOUNT_NAV = [
  { href: '/account', label: 'Account' },
];

interface Config {
  demoMode: boolean;
  demoReason: 'forced' | 'unconfigured' | null;
  liveReads?: boolean;
  live?: { hospitals: number; bookable: number } | null;
  careAccess?: { systemTransitionsConfigured: boolean };
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
      {config && <DataSourceNotice config={config} />}

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
            <Link
              href="/messages"
              aria-label="Messages"
              className="fc-btn-secondary !min-h-[38px] !px-2.5 text-xs"
            >
              <IconMessage width={16} height={16} />
              <span>Messages</span>
            </Link>
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
        <div className="grid grid-cols-6">
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
 * One compact strip for "where did this data come from".
 *
 * This used to be five lines of prose across the top of every page. The
 * disclosure itself is not optional - the app serves locally generated
 * appointment slots and synthetic reviews, and saying so is the difference
 * between a demo and a misrepresentation. But the full text does not need to
 * be shouted on every page load to stay honest.
 *
 * So: the caveat that actually affects what a visitor is looking at stays on
 * the face of it, the rest sits one click away, and dismissing it lasts for
 * the tab rather than for ever. Nothing here can be configured away.
 */
function DataSourceNotice({ config }: { config: Config }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  // sessionStorage, not localStorage: a dismissal should not silently carry
  // into a later visit by somebody who never saw the notice in the first place.
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem('fc-data-notice-dismissed') === '1');
    } catch {
      /* private mode - just show it */
    }
  }, []);

  const live = Boolean(config.liveReads);
  if (!live && !config.demoMode) return null;
  if (hidden) return null;

  const n = config.live?.hospitals;
  const forced = config.demoReason === 'forced';

  const tone = live
    ? 'bg-sky-50 text-sky-950 border-sky-200'
    : 'bg-amber-50 text-amber-900 border-amber-200';

  const summary = live
    ? `Live database${n ? ` · ${n} hospitals` : ''} · published slots only`
    : 'Demo data · synthetic records, not real hospitals or real patient feedback';

  const detail = live
    ? [
        `${n ? `${n} hospitals` : 'Hospitals'}, services, accessibility notes, arrival packs and support channels are read from the live Supabase project over RLS.`,
        'Published appointment slots are read from the live `slots` table and booking uses the database booking RPC. FlowCare does not invent availability for facilities without a published slot.',
        'The Care Access exchange uses the live additive Supabase tables. FlowCare reviews are not surfaced in this compatibility mode, so no FlowCare ratings are shown.',
      ]
    : [
        forced
          ? 'Demo mode is switched on for this deployment (FLOWCARE_DEMO_MODE), so Supabase is bypassed and hospitals, sessions, appointments and reviews are synthetic records generated locally.'
          : 'Supabase is not configured, so hospitals, sessions, appointments and reviews are synthetic records generated locally.',
        'They are not real hospitals or real patient feedback.',
      ];

  if (live && config.careAccess && !config.careAccess.systemTransitionsConfigured) {
    detail.push('Server-only Care Access transitions are disabled until SUPABASE_SERVICE_ROLE_KEY is configured; the app fails closed rather than using a local fallback.');
  }
  if (!config.googleMaps.serverConfigured) {
    detail.push('Google Maps is not configured, so no Google ratings or photos are shown.');
  }
  if (!config.ai.anyProviderConfigured) {
    detail.push("No AI provider is configured, so the assistant uses FlowCare's deterministic parser.");
  }

  return (
    <div className={`border-b px-4 text-[12px] ${tone}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-2 py-1.5">
        <span className="truncate font-medium">{summary}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="fc-data-notice-detail"
          className="shrink-0 rounded px-1.5 py-0.5 font-semibold underline underline-offset-2 hover:opacity-70"
        >
          {open ? 'Less' : 'Details'}
        </button>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            try {
              sessionStorage.setItem('fc-data-notice-dismissed', '1');
            } catch {
              /* nothing to persist to */
            }
          }}
          aria-label="Dismiss the data source notice for this session"
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-sm leading-none hover:opacity-70"
        >
          ×
        </button>
      </div>
      {open && (
        <div id="fc-data-notice-detail" className="mx-auto max-w-7xl pb-2">
          <ul className="list-disc space-y-1 pl-5">
            {detail.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
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
