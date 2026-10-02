'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AvailabilityPill, DemoBadge, FlowCareRating, GoogleRating, SourceTag, VerifiedBadge } from './Badges';
import { GoogleAttribution } from './GoogleAttribution';
import { ReviewsPanel } from './ReviewsPanel';
import { MapView } from './MapView';
import {
  IconAccessible, IconCalendar, IconClock, IconCompare, IconExternal, IconHeart, IconInfo, IconPin,
} from './Icons';
import {
  AccessibilityPanel, ArrivalPanel, ChargesPanel, FreshnessPanel, LanguagesPanel,
  PrepPanel, SchemesPanel, ServicesPanel,
} from './FacilityFacts';
import { CorrectionDialog } from './CorrectionDialog';
import { TravelPanel } from './TravelPanel';
import type { FacilityFactsView } from '@/lib/journey/factsView';
import { label } from '@/lib/discovery/filters';
import { pushRecentlyViewed, trackEvent, useCompareBasket, useSessionId } from '@/lib/client/hooks';
import type { DiscoveryResult, HospitalReview, FlowCareRatingSummary } from '@/lib/types';
import { formatDate, formatDateTime, formatTime } from '@/lib/time';

interface Detail extends Omit<DiscoveryResult, 'match'> {
  ratingExplanation: string;
  reviews: HospitalReview[];
  flowcareReviewSummary: {
    available: boolean; reason: string | null;
    positives: Array<{ theme: string; count: number }>;
    negatives: Array<{ theme: string; count: number }>;
    basedOn: number;
  };
}

interface GoogleReviewPayload {
  status: string;
  googleMapsUri?: string | null;
  reviews: Array<{ rating: number | null; text: string | null; relativeTime: string | null; author: string | null; authorUri: string | null; authorPhotoUri: string | null; flagContentUri: string | null }>;
  reviewSummary: { text: string | null; disclosure: string | null; reviewsUri: string | null; flagContentUri: string | null } | null;
  message?: string | null;
  attribution?: { provider: string; notice: string };
}

export function HospitalProfile({ id }: { id: string }) {
  const sessionId = useSessionId();
  const compare = useCompareBasket();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [gReviews, setGReviews] = useState<GoogleReviewPayload | null>(null);
  const [gLoading, setGLoading] = useState(false);

  /* Journey layer (F2/F4/F5/F7/F8/F9/F10/F12/F18). Fetched separately from
   * the core profile so a facts failure degrades one section rather than
   * blanking the page. */
  const [facts, setFacts] = useState<FacilityFactsView | null>(null);
  const [prepContext, setPrepContext] = useState({
    firstVisit: true, usingScheme: false, isProcedure: false,
  });
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    fetch(`/api/hospitals/${encodeURIComponent(id)}`, { headers: { 'x-flowcare-session': sessionId } })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error?.message ?? 'Not found');
        setD(j.data);
        pushRecentlyViewed(j.data.hospital.slug, j.data.hospital.name);
      })
      .catch((e) => setError(e.message));
  }, [id, sessionId]);

  useEffect(() => {
    const qs = new URLSearchParams({
      firstVisit: String(prepContext.firstVisit),
      scheme: String(prepContext.usingScheme),
      procedure: String(prepContext.isProcedure),
    });
    fetch(`/api/hospitals/${encodeURIComponent(id)}/facts?${qs}`, {
      headers: { 'x-flowcare-session': sessionId },
    })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setFacts(j.data.facts); })
      .catch(() => setFacts(null));
  }, [id, sessionId, prepContext]);

  useEffect(() => {
    fetch('/api/favorites')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setSaved((j.data.favorites ?? []).some((f: { hospitalId: string }) => f.hospitalId === d?.hospital.id)))
      .catch(() => {});
  }, [d?.hospital.id]);

  if (error) {
    return (
      <div className="fc-card mt-6 p-8 text-center">
        <p className="text-base font-bold">Hospital not found</p>
        <p className="mt-1 text-sm text-ink-600">{error}</p>
        <Link href="/hospitals" className="fc-btn-primary mt-4">Back to discovery</Link>
      </div>
    );
  }
  if (!d) return <ProfileSkeleton />;

  const h = d.hospital;
  const depts = h.departments.filter((x) => x.active);
  const ext = d.external.data;

  const toggleSave = async () => {
    setSaveMsg(null);
    const res = saved
      ? await fetch(`/api/favorites?hospitalId=${encodeURIComponent(h.id)}`, { method: 'DELETE' })
      : await fetch('/api/favorites', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hospitalId: h.id }),
        });
    if (res.status === 401) { setSaveMsg('Sign in to save hospitals.'); return; }
    if (res.ok) setSaved(!saved);
  };

  const loadGoogleReviews = async () => {
    if (!d.external.placeId) return;
    setGLoading(true);
    try {
      const r = await fetch(`/api/places/${encodeURIComponent(d.external.placeId)}/reviews`);
      const j = await r.json();
      setGReviews(j.data);
    } finally {
      setGLoading(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <nav className="text-xs text-ink-500">
        <Link href="/hospitals" className="hover:underline">Discover</Link> <span className="mx-1">/</span>
        <span className="font-medium text-ink-700">{h.name}</span>
      </nav>

      {/* Header */}
      <header className="fc-card p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {h.flowcareVerified && <VerifiedBadge />}
          {h.isDemoRecord && <DemoBadge />}
          <span className="fc-pill bg-ink-100 text-ink-700">{label(h.type)}</span>
          {h.emergencyServices && <span className="fc-pill bg-rose-50 text-rose-700 ring-1 ring-rose-200">Emergency services</span>}
        </div>

        <h1 className="mt-2.5 text-xl font-extrabold leading-tight text-ink-900 md:text-2xl">{h.name}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-600">
          <IconPin width={15} height={15} /> {h.addressLine}, {h.city}, {h.state}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <AvailabilityPill state={d.availability.state} nextDate={d.availability.nextAvailableDate} computedAt={d.availability.computedAt} />
          <FlowCareRating summary={d.flowcareRating} showMethod />
          <GoogleRating rating={ext?.rating} count={ext?.userRatingCount} uri={ext?.googleMapsUri} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/appointments/new?hospital=${h.slug}`}
            onClick={() => trackEvent('booking_initiated', sessionId, { hospital_id: h.id })}
            className={`fc-btn-primary flex-1 sm:flex-none ${d.availability.state === 'none' ? 'pointer-events-none opacity-40' : ''}`}
          >
            <IconCalendar width={17} height={17} /> Book an appointment
          </Link>
          <button onClick={toggleSave} className={`fc-btn-secondary ${saved ? '!border-rose-200 !bg-rose-50 !text-rose-700' : ''}`}>
            <IconHeart width={17} height={17} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={() => compare.toggle(h.id)}
            className={`fc-btn-secondary ${compare.ids.includes(h.id) ? '!border-brand-300 !bg-brand-50 !text-brand-700' : ''}`}
          >
            <IconCompare width={17} height={17} /> {compare.ids.includes(h.id) ? 'In comparison' : 'Compare'}
          </button>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${h.location.lat},${h.location.lng}${d.external.placeId ? `&destination_place_id=${d.external.placeId}` : ''}`}
            target="_blank" rel="noopener noreferrer" className="fc-btn-secondary"
          >
            <IconExternal width={16} height={16} /> Directions
          </a>
          {/* F11 — everything needed at the gate, with no Google content. */}
          <Link href={`/visit/${h.id}`} className="fc-btn-secondary">
            <IconInfo width={16} height={16} /> Visit card
          </Link>
        </div>
        {saveMsg && <p className="mt-2 text-xs font-medium text-amber-700">{saveMsg}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* FlowCare operational */}
          <section className="fc-card p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">FlowCare operational information</h2>
              <SourceTag source="flowcare" />
            </div>
            <p className="mt-1 text-xs text-ink-500">
              Held and verified by FlowCare. Availability snapshot computed {formatDateTime(d.availability.computedAt)}.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Stat title="Appointment availability" value={
                d.availability.state === 'unknown' ? 'Unknown — no FlowCare sessions published'
                : d.availability.state === 'none' ? `No open slots in the next ${d.availability.windowDays} days`
                : `${d.availability.openSlots} open slot(s) in the next ${d.availability.windowDays} days`
              } />
              <Stat title="Earliest bookable date" value={d.availability.nextAvailableDate ?? 'None in the window'} />
              <Stat title="Operational status" value={h.flowcareVerified ? 'Onboarded and operating on FlowCare' : 'Onboarding in progress — bookings may be limited'} />
              <Stat
                title="Queue information"
                value={
                  d.queue?.published && d.queue.medianWaitMinutes !== null
                    ? `~${d.queue.medianWaitMinutes} min median wait · ${d.queue.waitingCount} waiting (as of ${d.queue.observedAt ? formatTime(d.queue.observedAt) : 'unknown'})`
                    : 'This hospital does not publish live queue information'
                }
              />
            </div>

            {Object.keys(d.availability.bySpecialty).length > 0 && (
              <div className="mt-4">
                <p className="fc-label mb-2">Open slots by department (next {d.availability.windowDays} days)</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(d.availability.bySpecialty).sort((a, b) => b[1] - a[1]).map(([sp, n]) => (
                    <Link key={sp} href={`/appointments/new?hospital=${h.slug}&department=${sp}`} className="fc-chip-off">
                      {label(sp)} <span className="font-bold text-brand-700">{n}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <p className="fc-label mb-2">Departments ({depts.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {depts.map((dep) => <span key={dep.id} className="fc-chip-off">{dep.name}</span>)}
              </div>
            </div>

            {h.services.length > 0 && (
              <div className="mt-4">
                <p className="fc-label mb-2">Services on site</p>
                <div className="flex flex-wrap gap-1.5">
                  {h.services.map((s) => <span key={s.id} className="fc-chip-off">{s.name}</span>)}
                </div>
              </div>
            )}
          </section>

          {/* Reviews */}
          <ReviewsPanel
            hospitalId={h.id}
            hospitalName={h.name}
            summary={d.flowcareRating}
            explanation={d.ratingExplanation}
            initialReviews={d.reviews}
            flowcareSummary={d.flowcareReviewSummary}
            isDemo={h.isDemoRecord}
          />

          {/* ---------------- Journey layer (F2/F4/F5/F7/F8/F9/F10/F12) ---- */}
          {facts && (
            <>
              <ArrivalPanel facts={facts} />
              <PrepPanel facts={facts} context={prepContext} onContextChange={setPrepContext} />
              <ChargesPanel facts={facts} />
              <SchemesPanel facts={facts} />
              <AccessibilityPanel facts={facts} />
              <LanguagesPanel facts={facts} />
              <ServicesPanel facts={facts} />
            </>
          )}

          {/* Google section */}
          <section className="fc-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Google Maps information</h2>
              <SourceTag source="google" />
            </div>

            {d.external.status === 'not_linked' && (
              <p className="mt-2 rounded-xl bg-ink-100 px-3 py-2.5 text-xs text-ink-600">
                No Google Place has been verified for this hospital yet. FlowCare links a Google Place only after an
                administrator confirms it, so a similarly-named location is never attached automatically.
              </p>
            )}
            {d.external.status === 'not_configured' && (
              <p className="mt-2 rounded-xl bg-ink-100 px-3 py-2.5 text-xs text-ink-600">
                Google Maps is not configured on this deployment, so no Google details, ratings, photos or reviews are shown.
              </p>
            )}
            {d.external.status === 'error' && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                Google Maps data could not be retrieved right now. Everything else on this page is FlowCare data.
              </p>
            )}

            {ext && (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Stat title="Name on Google" value={ext.displayName ?? '—'} />
                  <Stat title="Address on Google" value={ext.formattedAddress ?? '—'} />
                  <Stat title="Phone" value={ext.nationalPhoneNumber ?? '—'} />
                  <Stat title="Website" value={ext.websiteUri ?? '—'} href={ext.websiteUri} />
                </div>

                {ext.regularOpeningHours?.weekdayDescriptions && (
                  <div className="mt-4">
                    <p className="fc-label mb-1.5 flex items-center gap-1"><IconClock width={13} height={13} /> Opening hours (Google)</p>
                    <ul className="space-y-0.5 text-xs text-ink-700">
                      {ext.regularOpeningHours.weekdayDescriptions.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {ext.accessibilityOptions && Object.keys(ext.accessibilityOptions).length > 0 && (
                  <div className="mt-4">
                    <p className="fc-label mb-1.5 flex items-center gap-1"><IconAccessible width={13} height={13} /> Accessibility (Google)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(ext.accessibilityOptions).filter(([, v]) => v).map(([k]) => (
                        <span key={k} className="fc-chip-off">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                      ))}
                    </div>
                  </div>
                )}

                {ext.photos && ext.photos.length > 0 && (
                  <div className="mt-4">
                    <p className="fc-label mb-1.5">Photos (Google)</p>
                    <div className="flex gap-2 overflow-x-auto fc-scroll-hide">
                      {ext.photos.slice(0, 6).map((p) => (
                        <figure key={p.name} className="shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/places/photo?name=${encodeURIComponent(p.name)}&w=400`}
                            alt={`Photo of ${h.name} from Google Maps`}
                            loading="lazy"
                            className="h-32 w-48 rounded-xl object-cover"
                          />
                          <figcaption className="mt-1 max-w-[192px] truncate text-[10px] text-ink-500">
                            {p.authorAttributions?.[0]?.uri ? (
                              <a href={p.authorAttributions[0].uri} target="_blank" rel="noopener noreferrer" className="underline">
                                © {p.authorAttributions[0].displayName}
                              </a>
                            ) : (
                              <>© {p.authorAttributions?.[0]?.displayName ?? 'Google Maps contributor'}</>
                            )}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  {!gReviews ? (
                    <button onClick={loadGoogleReviews} disabled={gLoading} className="fc-btn-secondary text-xs">
                      {gLoading ? 'Loading Google reviews…' : 'Load Google reviews & summary'}
                    </button>
                  ) : (
                    <GoogleReviewsBlock payload={gReviews} />
                  )}
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    Loaded on demand — Google bills reviews and review summaries at its most expensive tier.
                  </p>
                </div>

                <p className="mt-3 text-[11px] text-ink-400">
                  Retrieved from Google {formatDateTime(ext.fetchedAt)}. FlowCare does not store this content.
                </p>
              </>
            )}

            <div className="mt-3"><GoogleAttribution variant="block" mapsUri={ext?.googleMapsUri} /></div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <section className="fc-card overflow-hidden">
            <div className="h-48">
              <MapView
                results={[{ ...d, match: null } as DiscoveryResult]}
                origin={null}
                selectedId={null}
                onSelect={() => {}}
              />
            </div>
            <div className="p-4 text-xs">
              <p className="font-semibold text-ink-800">{h.addressLine}</p>
              <p className="text-ink-500">{h.city}, {h.state}</p>
              {h.phone && <p className="mt-2"><a href={`tel:${h.phone}`} className="font-semibold text-brand-700">{h.phone}</a> <SourceTag source="flowcare" /></p>}
            </div>
          </section>

          <section className="fc-card p-4">
            <h2 className="text-sm font-bold">FlowCare-recorded details</h2>
            <dl className="mt-2.5 space-y-2 text-xs">
              <Row k="Hospital type" v={label(h.type)} />
              <Row k="Beds" v={h.bedCount ? String(h.bedCount) : 'Not recorded'} />
              <Row k="Emergency services" v={h.emergencyServices ? 'Yes' : 'No'} />
              <Row k="Languages" v={h.languages.map(label).join(', ')} />
              <Row k="Onboarded" v={h.onboardedAt ? formatDate(h.onboardedAt) : 'Not yet'} />
            </dl>
            {h.accessibility.length > 0 && (
              <div className="mt-3">
                <p className="fc-label mb-1.5 flex items-center gap-1"><IconAccessible width={13} height={13} /> Accessibility</p>
                <ul className="space-y-1 text-xs text-ink-700">
                  {h.accessibility.map((a) => <li key={a}>• {label(a)}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-3">
              <p className="fc-label mb-1.5">Operating hours (FlowCare record)</p>
              <ul className="space-y-0.5 text-xs text-ink-700">
                {Object.entries(h.operatingHours).map(([day, hrs]) => (
                  <li key={day} className="flex justify-between gap-3"><span>{day}</span><span className="font-medium">{hrs}</span></li>
                ))}
              </ul>
            </div>
          </section>

          {facts && <FreshnessPanel facts={facts} />}

          <TravelPanel hospitalId={h.id} hospitalName={h.name} />

          {/* F17 — the repair path. Always visible, never buried. */}
          <section className="fc-card p-4">
            {reporting ? (
              <CorrectionDialog
                hospitalId={h.id}
                hospitalName={h.name}
                onClose={() => setReporting(false)}
              />
            ) : (
              <>
                <h2 className="text-sm font-bold">Something wrong here?</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
                  Details go out of date. If you called and the number was dead,
                  or the department has moved, tell us and a person will check it.
                </p>
                <button
                  type="button"
                  className="fc-btn-secondary mt-2.5 !py-1.5 !text-xs"
                  onClick={() => setReporting(true)}
                >
                  Report a problem
                </button>
              </>
            )}
          </section>

          <section className="fc-card bg-ink-50 p-4">
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-600">
              <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
              FlowCare is a hospital directory and appointment tool. Nothing on this page is medical advice, and none of
              these figures measure clinical quality or outcomes.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function GoogleReviewsBlock({ payload }: { payload: GoogleReviewPayload }) {
  if (payload.status !== 'ok') {
    return <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{payload.message ?? 'Google reviews are unavailable.'}</p>;
  }
  return (
    <div className="space-y-3">
      {payload.reviewSummary?.text && (
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">
            Google review summary — generated by Google, not by FlowCare
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-800">{payload.reviewSummary.text}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-ink-500">
            {payload.reviewSummary.disclosure && <span className="font-semibold">{payload.reviewSummary.disclosure}</span>}
            {payload.reviewSummary.reviewsUri && (
              <a href={payload.reviewSummary.reviewsUri} target="_blank" rel="noopener noreferrer" className="underline">See the reviews on Google Maps</a>
            )}
            {payload.reviewSummary.flagContentUri && (
              <a href={payload.reviewSummary.flagContentUri} target="_blank" rel="noopener noreferrer" className="underline">Report a problem with this summary</a>
            )}
          </p>
        </div>
      )}

      {payload.reviews.length === 0 && <p className="text-xs text-ink-500">Google returned no reviews for this place.</p>}

      {payload.reviews.map((r, i) => (
        <article key={i} className="rounded-xl border border-ink-200 p-3">
          <div className="flex items-center gap-2">
            {r.authorPhotoUri && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={r.authorPhotoUri} alt="" width={22} height={22} className="rounded-full" loading="lazy" />
            )}
            <span className="text-xs font-semibold text-ink-800">
              {r.authorUri ? <a href={r.authorUri} target="_blank" rel="noopener noreferrer" className="underline">{r.author}</a> : r.author}
            </span>
            {r.rating !== null && <span className="fc-pill bg-ink-100 text-ink-700">{r.rating.toFixed(1)} ★</span>}
            <span className="ml-auto text-[10px] text-ink-400">{r.relativeTime}</span>
          </div>
          {r.text && <p className="mt-1.5 text-xs leading-relaxed text-ink-700">{r.text}</p>}
          {r.flagContentUri && (
            <a href={r.flagContentUri} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[10px] text-ink-400 underline">
              Report this review on Google
            </a>
          )}
        </article>
      ))}
      {payload.googleMapsUri && (
        <a href={payload.googleMapsUri} target="_blank" rel="noopener noreferrer" className="fc-btn-secondary w-full text-xs">
          <IconExternal width={14} height={14} /> Read all reviews on Google Maps
        </a>
      )}
    </div>
  );
}

function Stat({ title, value, href }: { title: string; value: string; href?: string | null }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
      <p className="fc-label">{title}</p>
      <p className="mt-1 break-words text-sm font-medium text-ink-800">
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">{value}</a> : value}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="text-right font-medium text-ink-800">{v}</dd>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4 py-4">
      <div className="fc-card p-5">
        <div className="fc-skeleton h-4 w-32" />
        <div className="fc-skeleton mt-3 h-7 w-2/3" />
        <div className="fc-skeleton mt-2 h-4 w-1/2" />
        <div className="fc-skeleton mt-4 h-10 w-full" />
      </div>
      <div className="fc-card h-64" />
    </div>
  );
}

export type { FlowCareRatingSummary };
