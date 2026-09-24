'use client';

/**
 * The journey-layer panels on a hospital profile: what the place actually
 * costs, who it is usable by, what to bring, and how to get in the door.
 *
 * Each panel owns its own caveat. Copy like SCHEME_CAVEAT is imported from
 * the vocabulary module rather than typed here, so it cannot drift from the
 * rule it describes or be quietly dropped by a later edit.
 */
import { useState } from 'react';
import { ProvenanceChip, FreshnessSummaryBar, StaticChip } from './ProvenanceChip';
import { IconAccessible, IconCheck, IconClock, IconInfo, IconPin } from './Icons';
import { languageName, type FacilityFactsView } from '@/lib/journey/factsView';
import type { AccessibilityStatus } from '@/lib/types';

function Card({
  title, subtitle, children, icon,
}: {
  title: string; subtitle?: string; children: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <section className="fc-card p-5">
      <div className="flex items-start gap-2">
        {icon}
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-600">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-700">
      <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">{children}</p>;
}

/* ------------------------------------------------------------- F5 ------ */

export function ChargesPanel({ facts }: { facts: FacilityFactsView }) {
  const { charges } = facts;
  return (
    <Card
      title="What the visit costs to start"
      subtitle="Administrative charges the hospital publishes"
    >
      {charges.empty ? (
        <Empty>{charges.emptyMessage}</Empty>
      ) : (
        <ul className="divide-y divide-ink-100">
          {charges.items.map((c) => (
            <li key={c.chargeType} className="flex items-baseline justify-between gap-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink-800">{c.label}</p>
                <ProvenanceChip className="mt-1" freshness={c.freshness} />
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums text-ink-900">{c.display}</p>
            </li>
          ))}
        </ul>
      )}
      <Caveat>{charges.caveat}</Caveat>
    </Card>
  );
}

/* ------------------------------------------------------------- F4 ------ */

export function SchemesPanel({ facts }: { facts: FacilityFactsView }) {
  const { schemes } = facts;
  return (
    <Card title="Government schemes" subtitle="Whether this hospital appears on a scheme registry">
      {schemes.empty ? (
        <Empty>{schemes.emptyMessage}</Empty>
      ) : (
        <ul className="space-y-2">
          {schemes.items.map((s) => (
            <li key={s.code} className="flex flex-wrap items-center gap-2">
              <span className="fc-pill bg-brand-50 text-brand-800 ring-1 ring-brand-200">
                <IconCheck width={13} height={13} /> Listed · {s.name}
              </span>
              <ProvenanceChip freshness={s.freshness} />
            </li>
          ))}
        </ul>
      )}
      {/* Non-dismissible by design (R4). */}
      <Caveat>
        <strong className="font-semibold">Listed is not the same as cashless. </strong>
        {schemes.caveat}
      </Caveat>
    </Card>
  );
}

/* ------------------------------------------------------------- F7 ------ */

const STATUS_STYLE: Record<AccessibilityStatus, string> = {
  meets_standard: 'text-emerald-800 bg-emerald-50 ring-emerald-200',
  present_below_standard: 'text-amber-800 bg-amber-50 ring-amber-200',
  not_present: 'text-rose-800 bg-rose-50 ring-rose-200',
  not_assessed: 'text-ink-600 bg-ink-100 ring-ink-200',
};

export function AccessibilityPanel({ facts }: { facts: FacilityFactsView }) {
  const { accessibility } = facts;
  const [open, setOpen] = useState(false);
  const shown = open ? accessibility.items : accessibility.items.slice(0, 5);

  return (
    <Card
      title="Accessibility, component by component"
      subtitle="Each item is checked separately against a published standard"
      icon={<IconAccessible width={18} height={18} className="mt-0.5 shrink-0 text-ink-500" />}
    >
      {!accessibility.assessed ? (
        <Empty>{accessibility.notAssessedMessage}</Empty>
      ) : (
        <>
          {/* Counts, never a percentage or a grade (R7). */}
          <p className="mb-3 text-xs text-ink-600">
            <span className="font-semibold text-emerald-700">{accessibility.counts.meets_standard} meet the standard</span>
            {' · '}
            <span className="font-semibold text-amber-700">{accessibility.counts.present_below_standard} below standard</span>
            {' · '}
            <span className="font-semibold text-rose-700">{accessibility.counts.not_present} not present</span>
            {' · '}
            <span className="font-semibold text-ink-600">{accessibility.counts.not_assessed} not assessed</span>
          </p>

          <ul className="divide-y divide-ink-100">
            {shown.map((c) => (
              <li key={c.code} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-800">{c.label}</p>
                    {c.question && <p className="mt-0.5 text-[11px] text-ink-500">{c.question}</p>}
                  </div>
                  <span
                    className={`fc-pill shrink-0 !text-[10.5px] ring-1 ${STATUS_STYLE[c.status]}`}
                  >
                    {c.statusLabel}
                  </span>
                </div>
                {c.note && (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900">
                    {c.note}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <ProvenanceChip freshness={c.freshness} />
                  {c.standardReference && (
                    <span className="text-[10.5px] text-ink-500">{c.standardReference}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {accessibility.items.length > 5 && (
            <button type="button" className="fc-btn-ghost mt-2 !px-2 !py-1 !text-xs" onClick={() => setOpen(!open)}>
              {open ? 'Show fewer' : `Show all ${accessibility.items.length} components`}
            </button>
          )}
        </>
      )}
      <Caveat>
        FlowCare does not give a hospital an accessibility score. A ramp does not
        compensate for a toilet you cannot use, so each component stands on its own.
      </Caveat>
    </Card>
  );
}

/* ------------------------------------------------------------- F8 ------ */

export function LanguagesPanel({ facts }: { facts: FacilityFactsView }) {
  const { languages } = facts;
  if (!languages.stages.length) return null;

  return (
    <Card
      title="Languages, stage by stage"
      subtitle="Where in the visit each language is actually spoken"
    >
      {languages.gapWarning && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <strong className="font-semibold">Worth knowing: </strong>
          {languages.gapWarning}
        </p>
      )}
      <ul className="divide-y divide-ink-100">
        {languages.stages.map((s) => (
          <li key={s.stage} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
            <span className="text-sm text-ink-700">{s.stageLabel}</span>
            <span className="text-sm font-medium text-ink-900">
              {s.languages.length
                ? s.languages.map(languageName).join(', ')
                : <span className="font-normal text-ink-500">Not reported</span>}
            </span>
          </li>
        ))}
      </ul>
      <Caveat>
        Reported by the hospital, not observed at every counter. If language
        support is the reason you are choosing this hospital, call and confirm.
      </Caveat>
    </Card>
  );
}

/* ------------------------------------------------------------- F2 ------ */

export function ServicesPanel({ facts }: { facts: FacilityFactsView }) {
  const verified = facts.services.filter((s) => s.verified);
  const unverified = facts.services.filter((s) => !s.verified);

  return (
    <Card title="Services at this location" subtitle="Confirmed here, not just somewhere in the group">
      {verified.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {verified.map((s) => (
            <li key={s.slug}>
              <span className="fc-pill bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
                <IconCheck width={13} height={13} /> {s.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      {unverified.length > 0 && (
        <div className={verified.length ? 'mt-3.5' : ''}>
          <p className="fc-label mb-1.5">Listed, not confirmed by FlowCare</p>
          <ul className="flex flex-wrap gap-2">
            {unverified.map((s) => (
              <li key={s.slug}>
                <span className="fc-pill bg-ink-100 text-ink-600 ring-1 ring-ink-200">
                  {s.name}
                  {s.pending && <span className="font-normal">· reported, being checked</span>}
                </span>
              </li>
            ))}
          </ul>
          <Caveat>
            These are not used when you filter by service. A patient who travels
            for a scan that is not there has lost a day, so FlowCare only matches
            filters against services it has confirmed at this address.
          </Caveat>
        </div>
      )}

      {!facts.services.length && <Empty>No services recorded for this hospital.</Empty>}
    </Card>
  );
}

/* ------------------------------------------------------------- F9 ------ */

export function PrepPanel({
  facts, onContextChange, context,
}: {
  facts: FacilityFactsView;
  context: { firstVisit: boolean; usingScheme: boolean; isProcedure: boolean };
  onContextChange: (c: { firstVisit: boolean; usingScheme: boolean; isProcedure: boolean }) => void;
}) {
  const { prep } = facts;
  return (
    <Card title="What to bring" subtitle="Documents and payments only">
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={context.firstVisit ? 'fc-chip-on' : 'fc-chip-off'}
          onClick={() => onContextChange({ ...context, firstVisit: !context.firstVisit })}
        >
          First visit here
        </button>
        <button
          type="button"
          className={context.usingScheme ? 'fc-chip-on' : 'fc-chip-off'}
          onClick={() => onContextChange({ ...context, usingScheme: !context.usingScheme })}
        >
          Using a scheme
        </button>
        <button
          type="button"
          className={context.isProcedure ? 'fc-chip-on' : 'fc-chip-off'}
          onClick={() => onContextChange({ ...context, isProcedure: !context.isProcedure })}
        >
          Procedure or day-care
        </button>
      </div>

      {prep.empty ? (
        <Empty>{prep.emptyMessage}</Empty>
      ) : (
        <ul className="space-y-2">
          {prep.items.map((i, idx) => (
            <li key={`${i.value.code}-${idx}`} className="flex items-start gap-2.5">
              <span className="mt-1 h-4 w-4 shrink-0 rounded border-2 border-ink-300" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm leading-snug text-ink-800">{i.value.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ProvenanceChip freshness={i.freshness} />
                  {i.value.conditional && <StaticChip text="because of your answers above" />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* The boundary of the feature, stated every time (R9). */}
      <Caveat>{prep.notice}</Caveat>
    </Card>
  );
}

/* ------------------------------------------- F10 / F12 / F13 / F14 ----- */

export function ArrivalPanel({ facts }: { facts: FacilityFactsView }) {
  const { arrival } = facts;
  const [locale, setLocale] = useState<string>('en');

  if (!arrival.pack) {
    return (
      <Card title="Getting in the door" icon={<IconPin width={18} height={18} className="mt-0.5 shrink-0 text-ink-500" />}>
        <Empty>{arrival.emptyMessage}</Empty>
      </Card>
    );
  }

  const p = arrival.pack.value;
  const routes = arrival.routes.filter((r) => r.value.locale === locale);

  return (
    <Card
      title="Getting in the door"
      subtitle="Which gate, which counter, what happens first"
      icon={<IconPin width={18} height={18} className="mt-0.5 shrink-0 text-ink-500" />}
    >
      <ProvenanceChip freshness={arrival.pack.freshness} />

      <dl className="mt-3 space-y-2.5 text-sm">
        {p.gateLabel && (
          <div>
            <dt className="fc-label">Use this entrance</dt>
            <dd className="text-ink-800">{p.gateLabel}</dd>
            {p.gateNote && <dd className="mt-0.5 text-xs text-amber-900">{p.gateNote}</dd>}
          </div>
        )}
        {p.firstCounter && (
          <div>
            <dt className="fc-label">Go here first</dt>
            <dd className="text-ink-800">{p.firstCounter}</dd>
          </div>
        )}
        {p.buildingNote && (
          <div>
            <dt className="fc-label">Layout</dt>
            <dd className="text-ink-700">{p.buildingNote}</dd>
          </div>
        )}
        {p.parkingNote && (
          <div>
            <dt className="fc-label">Parking</dt>
            <dd className="text-ink-700">{p.parkingNote}</dd>
          </div>
        )}
        {p.dropoffNote && (
          <div>
            <dt className="fc-label">Drop-off</dt>
            <dd className="text-ink-700">{p.dropoffNote}</dd>
          </div>
        )}
      </dl>

      {/* F13 — process facts only, never a predicted wait. */}
      {p.arrivalGuidanceText && (
        <div className="mt-3.5 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100">
          <p className="fc-label mb-1 flex items-center gap-1.5 !text-brand-700">
            <IconClock width={13} height={13} /> When to arrive
          </p>
          <p className="text-xs leading-relaxed text-ink-800">{p.arrivalGuidanceText}</p>
        </div>
      )}

      {/* F14 — late policy, stated rather than implied. */}
      {p.latePolicyText && (
        <div className="mt-2.5 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="fc-label mb-1 !text-amber-800">If you are running late</p>
          <p className="text-xs leading-relaxed text-amber-900">{p.latePolicyText}</p>
        </div>
      )}

      {/* F12 — static landmark steps. */}
      {arrival.routes.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="fc-label !mb-0">Step-by-step from the gate</p>
            {arrival.availableLocales.length > 1 &&
              arrival.availableLocales.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={locale === l ? 'fc-chip-on !py-0.5 !text-[11px]' : 'fc-chip-off !py-0.5 !text-[11px]'}
                >
                  {l === 'mr' ? 'मराठी' : l === 'hi' ? 'हिंदी' : 'English'}
                </button>
              ))}
          </div>

          {routes.map((r, i) => (
            <div key={i} className="mb-3 rounded-xl border border-ink-200 p-3">
              <p className="text-xs font-semibold text-ink-800">
                {r.value.fromPoint} → {r.value.toPoint}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {r.value.walkingMinutes != null && `About ${r.value.walkingMinutes} min on foot. `}
                {r.value.stepFree === true && 'Step-free.'}
                {r.value.stepFree === false && 'Not step-free.'}
                {r.value.stepFree === null && 'Step-free status unknown.'}
              </p>
              <ol className="mt-2 space-y-1.5">
                {r.value.steps.map((step, si) => (
                  <li key={si} className="flex gap-2 text-xs leading-relaxed text-ink-700">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-600">
                      {si + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <div className="mt-2"><ProvenanceChip freshness={r.freshness} /></div>
            </div>
          ))}
        </div>
      )}

      <Caveat>{arrival.timingNotice}</Caveat>
    </Card>
  );
}

/* -------------------------------------------------------------- F18 ---- */

export function FreshnessPanel({ facts }: { facts: FacilityFactsView }) {
  return (
    <section className="fc-card p-4">
      <h2 className="text-sm font-bold">How current is this page?</h2>
      <div className="mt-2.5">
        <FreshnessSummaryBar summary={facts.freshness} />
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-600">
        &ldquo;Verified&rdquo; means a person checked on that date. It is not a
        guarantee that nothing has changed since. FlowCare deliberately does not
        turn this into a single trust score.
      </p>
    </section>
  );
}
