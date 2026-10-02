'use client';

/**
 * F11 — the offline visit card.
 *
 * Designed for the moment a patient is standing at a gate with no signal and
 * one bar of battery. Print-friendly, high contrast, and small enough to
 * screenshot.
 *
 * THE RULE THAT SHAPES THIS FILE (R11): zero Google content. No map tile, no
 * Google photo, no Google-sourced address, rating or phone number. Google
 * Maps Service Terms §14.3 prohibit storing that content, and anything shown
 * here is by definition about to be stored on someone's device — screenshot,
 * print, or browser cache. Every field below comes from FlowCare's own
 * directory record, and the card says so on its face.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconCheck, IconInfo, IconPin } from './Icons';
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
        <Link href="/hospitals" className="fc-btn-secondary mt-3 !py-2 !text-xs">
          Back to search
        </Link>
      </div>
    );
  }

  if (!card) {
    return <div className="fc-skeleton h-96 w-full" />;
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-extrabold text-ink-900">Visit card</h1>
          <p className="text-xs text-ink-600">
            Save this page or take a screenshot. It works with no signal.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="fc-btn-secondary !py-2 !text-xs" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <Link href={`/hospitals/${hospitalId}`} className="fc-btn-ghost !py-2 !text-xs">
            Back to hospital
          </Link>
        </div>
      </div>

      {/* The card itself. Deliberately plain so it survives a screenshot. */}
      <article className="rounded-2xl border-2 border-ink-900 bg-white p-5 print:border-black">
        <header className="border-b-2 border-ink-900 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
            FlowCare visit card
          </p>
          <h2 className="mt-1 text-lg font-extrabold leading-tight text-ink-900">
            {card.hospital.name}
          </h2>
          <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-700">
            <IconPin width={14} height={14} className="mt-0.5 shrink-0" />
            {card.hospital.addressLine}, {card.hospital.city}
          </p>
          {card.hospital.phone && (
            <p className="mt-1 text-sm">
              <span className="text-ink-500">Phone: </span>
              <a href={`tel:${card.hospital.phone}`} className="font-bold text-ink-900">
                {card.hospital.phone}
              </a>
            </p>
          )}
        </header>

        {card.arrival && (
          <section className="border-b border-ink-200 py-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              Where to go
            </h3>
            {card.arrival.gateLabel && (
              <p className="mt-1.5 text-base font-bold text-ink-900">{card.arrival.gateLabel}</p>
            )}
            {card.arrival.gateNote && (
              <p className="mt-0.5 text-sm leading-snug text-ink-700">{card.arrival.gateNote}</p>
            )}
            {card.arrival.firstCounter && (
              <p className="mt-2 text-sm text-ink-800">
                <span className="font-semibold">Go here first: </span>
                {card.arrival.firstCounter}
              </p>
            )}
            {card.arrival.buildingNote && (
              <p className="mt-1 text-sm leading-snug text-ink-700">{card.arrival.buildingNote}</p>
            )}
            <p className="mt-2 text-[10.5px] text-ink-500">
              {card.arrival.freshness.label}
              {card.arrival.freshness.caution && ` — ${card.arrival.freshness.caution}`}
            </p>
          </section>
        )}

        {card.routes.length > 0 && (
          <section className="border-b border-ink-200 py-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              Step by step
            </h3>
            {card.routes.map((r, i) => (
              <div key={i} className="mt-2">
                <p className="text-xs font-bold text-ink-800">
                  {r.fromPoint} → {r.toPoint}
                  {r.walkingMinutes != null && (
                    <span className="font-normal text-ink-500"> · about {r.walkingMinutes} min</span>
                  )}
                  {r.stepFree === false && (
                    <span className="font-normal text-ink-500"> · not step-free</span>
                  )}
                </p>
                <ol className="mt-1.5 space-y-1">
                  {r.steps.map((s, si) => (
                    <li key={si} className="flex gap-2 text-sm leading-snug text-ink-800">
                      <span className="font-bold">{si + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        )}

        {card.checklist.length > 0 && (
          <section className="border-b border-ink-200 py-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              Bring with you
            </h3>
            <ul className="mt-1.5 space-y-1.5">
              {card.checklist.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-snug text-ink-800">
                  <span className="mt-0.5 h-4 w-4 shrink-0 border-2 border-ink-900" aria-hidden />
                  {c.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.arrival?.latePolicyText && (
          <section className="border-b border-ink-200 py-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              If you are late
            </h3>
            <p className="mt-1 text-sm leading-snug text-ink-800">{card.arrival.latePolicyText}</p>
          </section>
        )}

        <footer className="pt-3">
          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink-600">
            <IconInfo width={12} height={12} className="mt-0.5 shrink-0" />
            {card.sourceNotice}
          </p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-600">
            {card.checklistNotice}
          </p>
          <p className="mt-1.5 text-[10px] text-ink-400">
            Generated {formatDateTime(card.generatedAt)}
          </p>
        </footer>
      </article>

      {/* Verifiable claim, not a marketing line: the API asserts it too. */}
      {!card.containsGoogleContent && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-500 print:hidden">
          <IconCheck width={12} height={12} />
          This card contains no Google Maps content, so it is safe to keep offline.
        </p>
      )}
    </div>
  );
}
