'use client';

/**
 * F11 — the offline visit card.
 *
 * Designed for the moment a patient is standing at a gate with no signal and
 * one bar of battery. It is deliberately high contrast, printable and useful
 * even when a hospital has not yet entered an indoor arrival pack.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FlowCareBadge } from './Brand';
import { IconCheck, IconInfo, IconPin, IconShield } from './Icons';
import { formatDateTime } from '@/lib/time';

interface Card {
  generatedAt: string;
  locale: string;
  hospital: { name: string; addressLine: string; city: string; phone: string | null };
  arrival: {
    gateLabel: string | null;
    gateNote: string | null;
    firstCounter: string | null;
    buildingNote: string | null;
    latePolicyText: string | null;
    freshness: { label: string; caution: string | null };
  } | null;
  routes: Array<{
    fromPoint: string; toPoint: string; steps: string[];
    stepFree: boolean | null; walkingMinutes: number | null;
  }>;
  checklist: Array<{ text: string; conditional: boolean }>;
  checklistNotice: string;
  sourceNotice: string;
  containsGoogleContent: boolean;
}

export function VisitCard({ hospitalId }: { hospitalId: string }) {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/hospitals/${encodeURIComponent(hospitalId)}/visit-card`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error?.message ?? 'Could not build a visit card.');
        setCard(j.data.card);
      })
      .catch((e) => setError(e.message));
  }, [hospitalId]);

  if (error) {
    return (
      <div className="fc-card p-6 text-center">
        <p className="text-sm font-semibold text-ink-800">{error}</p>
        <Link href="/hospitals" className="fc-btn-secondary mt-3 !py-2 !text-xs">Back to search</Link>
      </div>
    );
  }

  if (!card) return <div className="fc-skeleton h-96 w-full" />;

  const practicalReminders = card.checklist.length > 0
    ? card.checklist
    : [
        { text: 'Keep your appointment details and hospital contact number available.', conditional: false },
        { text: 'Carry a government ID and any records or prescriptions relevant to your visit.', conditional: false },
        { text: 'Check with the hospital about payment, insurance or referral documents if they apply to you.', conditional: true },
      ];

  return (
    <div className="visit-card-print mx-auto max-w-4xl space-y-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <FlowCareBadge size={42} />
          <div>
            <p className="fc-eyebrow">Offline-ready care plan</p>
            <h1 className="text-xl font-extrabold tracking-tight text-ink-950">Your visit card</h1>
            <p className="text-xs text-ink-600">Save this page or print it before you leave.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="fc-btn-primary !py-2 !text-xs" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <Link href={`/hospitals/${hospitalId}`} className="fc-btn-secondary !py-2 !text-xs">Back to hospital</Link>
        </div>
      </div>

      <article className="visit-card-sheet overflow-hidden rounded-[28px] border border-brand-800/20 bg-white shadow-pop print:rounded-none print:border-black print:shadow-none">
        <header className="visit-card-hero relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-violet-700 px-5 py-6 text-white sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full border-[28px] border-white/10" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/75">
                <FlowCareBadge size={28} className="bg-white text-brand-700 shadow-none" />
                FlowCare visit card
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white ring-1 ring-white/20">
                <IconShield width={13} height={13} /> Works offline
              </span>
            </div>
            <h2 className="mt-7 max-w-2xl text-2xl font-extrabold leading-tight sm:text-3xl">{card.hospital.name}</h2>
            <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-white/85">
              <IconPin width={16} height={16} className="mt-0.5 shrink-0" />
              <span>{card.hospital.addressLine}, {card.hospital.city}</span>
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/12 px-4 py-3 ring-1 ring-white/15">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Hospital contact</p>
                {card.hospital.phone ? (
                  <a href={`tel:${card.hospital.phone}`} className="mt-1 block text-sm font-bold text-white underline decoration-white/40 underline-offset-4">{card.hospital.phone}</a>
                ) : (
                  <p className="mt-1 text-sm font-semibold text-white/80">Not recorded</p>
                )}
              </div>
              <div className="rounded-2xl bg-white/12 px-4 py-3 ring-1 ring-white/15">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Card generated</p>
                <p className="mt-1 text-sm font-bold text-white">{formatDateTime(card.generatedAt)}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="visit-card-content p-5 sm:p-8">
          <section className="rounded-2xl border border-brand-200 bg-brand-50/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="fc-eyebrow">Arrival snapshot</p>
                <h3 className="mt-1 text-lg font-extrabold text-ink-950">Start here</h3>
              </div>
              <span className="fc-pill bg-white text-brand-800 ring-1 ring-brand-200">FlowCare record</span>
            </div>
            {card.arrival ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white p-3 ring-1 ring-brand-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Gate / entrance</p>
                  <p className="mt-1 text-sm font-bold text-ink-900">{card.arrival.gateLabel ?? 'Not recorded'}</p>
                  {card.arrival.gateNote && <p className="mt-1 text-xs leading-relaxed text-ink-600">{card.arrival.gateNote}</p>}
                </div>
                <div className="rounded-xl bg-white p-3 ring-1 ring-brand-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">First counter</p>
                  <p className="mt-1 text-sm font-bold text-ink-900">{card.arrival.firstCounter ?? 'Not recorded'}</p>
                  {card.arrival.buildingNote && <p className="mt-1 text-xs leading-relaxed text-ink-600">{card.arrival.buildingNote}</p>}
                </div>
                <p className="text-[10.5px] text-ink-500 sm:col-span-2">
                  {card.arrival.freshness.label}{card.arrival.freshness.caution && ` — ${card.arrival.freshness.caution}`}
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-brand-300 bg-white/80 p-4">
                <p className="text-sm font-bold text-ink-900">Arrival instructions have not been recorded yet.</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-600">Use the address and hospital contact above, and call the hospital if you need gate or counter directions.</p>
              </div>
            )}
          </section>

          {card.routes.length > 0 ? (
            <section className="mt-5">
              <div className="flex items-end justify-between gap-2">
                <div><p className="fc-eyebrow">Inside the hospital</p><h3 className="mt-1 text-lg font-extrabold text-ink-950">Step by step</h3></div>
                <span className="text-xs font-semibold text-ink-500">{card.routes.length} route{card.routes.length === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-3 space-y-3">
                {card.routes.map((r, i) => (
                  <div key={i} className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
                    <p className="text-sm font-bold text-ink-900">
                      {r.fromPoint} <span className="px-1 text-brand-600">→</span> {r.toPoint}
                      {r.walkingMinutes != null && <span className="ml-1 text-xs font-normal text-ink-500">· about {r.walkingMinutes} min</span>}
                    </p>
                    <ol className="mt-3 space-y-2">
                      {r.steps.map((s, si) => <li key={si} className="flex gap-3 text-sm leading-snug text-ink-800"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{si + 1}</span><span>{s}</span></li>)}
                    </ol>
                    {r.stepFree === false && <p className="mt-3 text-[11px] font-semibold text-amber-700">This route is not marked step-free.</p>}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="mt-5 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
              <p className="fc-eyebrow">Indoor route</p>
              <p className="mt-1 text-sm font-bold text-ink-900">No indoor route is recorded for this hospital yet.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">The card still works offline with the verified address and contact details above.</p>
            </section>
          )}

          <section className="mt-5 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-end justify-between gap-2">
              <div><p className="fc-eyebrow">Practical reminders</p><h3 className="mt-1 text-lg font-extrabold text-ink-950">Before you leave</h3></div>
              <IconCheck width={20} height={20} className="text-brand-600" />
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-3">
              {practicalReminders.map((item, i) => (
                <li key={i} className="rounded-xl bg-ink-50 p-3 text-xs leading-relaxed text-ink-800 ring-1 ring-ink-100">
                  <span className="mb-2 grid h-6 w-6 place-items-center rounded-lg bg-brand-100 text-brand-700"><IconCheck width={14} height={14} /></span>
                  {item.text}{item.conditional && <span className="mt-1 block text-[10px] text-ink-500">If applicable</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">{card.checklistNotice}</p>
          </section>

          {card.arrival?.latePolicyText && (
            <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="fc-eyebrow text-amber-800">If you are late</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-950">{card.arrival.latePolicyText}</p>
            </section>
          )}

          <footer className="mt-6 border-t border-ink-200 pt-4">
            <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-600"><IconInfo width={13} height={13} className="mt-0.5 shrink-0" />{card.sourceNotice}</p>
            {!card.containsGoogleContent && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-brand-700"><IconShield width={13} height={13} />No Google Maps content is stored on this offline card.</p>}
          </footer>
        </div>
      </article>
    </div>
  );
}
