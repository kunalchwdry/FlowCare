'use client';

import { useEffect, useState } from 'react';
import { IconCheck, IconInfo, IconShield, IconStar } from './Icons';
import { SourceTag } from './Badges';
import type { FlowCareRatingSummary, HospitalReview } from '@/lib/types';

const DIMENSIONS: Array<{ key: keyof HospitalReview['ratings']; label: string; hint: string }> = [
  { key: 'overall', label: 'Overall experience', hint: 'Your visit taken as a whole' },
  { key: 'waiting', label: 'Waiting experience', hint: 'How the queue and wait were handled' },
  { key: 'staff', label: 'Staff experience', hint: 'Reception, nursing and support staff' },
  { key: 'appointment', label: 'Appointment experience', hint: 'Booking, reminders, running to time' },
  { key: 'facility', label: 'Facility experience', hint: 'Cleanliness, signage, accessibility' },
];

interface Eligibility {
  eligible: boolean;
  code: string | null;
  message: string;
  eligibleAppointments: Array<{ id: string; scheduledFor: string; completedAt: string | null; departmentId: string }>;
}

export function ReviewsPanel({
  hospitalId, hospitalName, summary, explanation, initialReviews, flowcareSummary, isDemo,
}: {
  hospitalId: string;
  hospitalName: string;
  summary: FlowCareRatingSummary;
  explanation: string;
  initialReviews: HospitalReview[];
  flowcareSummary: { available: boolean; reason: string | null; positives: Array<{ theme: string; count: number }>; negatives: Array<{ theme: string; count: number }>; basedOn: number };
  isDemo: boolean;
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showMethod, setShowMethod] = useState(false);

  useEffect(() => {
    fetch(`/api/hospitals/${encodeURIComponent(hospitalId)}/eligibility`)
      .then((r) => r.json())
      .then((j) => j.ok && setEligibility(j.data))
      .catch(() => {});
  }, [hospitalId]);

  const total = Object.values(summary.distribution).reduce((a, b) => a + b, 0);

  return (
    <section className="fc-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">FlowCare verified-visit reviews</h2>
        <SourceTag source="flowcare" />
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Only patients with a completed FlowCare visit at {hospitalName} can leave a review here. These are separate from
        Google reviews and are never mixed together.
      </p>

      {isDemo && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
          These are synthetic demo reviews generated for local development — they are not real patient feedback.
        </p>
      )}

      {/* Score block */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
        <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4 text-center">
          {summary.score === null ? (
            <>
              <p className="text-sm font-bold text-ink-700">Not enough FlowCare reviews yet</p>
              <p className="mt-1 text-[11px] text-ink-500">{summary.insufficientReason}</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-extrabold text-ink-900">{summary.score.toFixed(1)}</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                plausible range {summary.confidenceLow?.toFixed(1)}–{summary.confidenceHigh?.toFixed(1)}
              </p>
              <p className="mt-1 text-xs font-semibold text-ink-700">{summary.reviewCount} verified visits</p>
              {summary.rawMean !== null && (
                <p className="mt-0.5 text-[11px] text-ink-500">raw average {summary.rawMean.toFixed(2)}</p>
              )}
            </>
          )}
          <button onClick={() => setShowMethod((v) => !v)} className="mt-2 text-[11px] font-semibold text-brand-700 underline">
            How is this calculated?
          </button>
        </div>

        <div>
          {total > 0 ? (
            <div className="space-y-1">
              {(['5', '4', '3', '2', '1'] as const).map((star) => {
                const n = summary.distribution[star];
                const pct = total ? (n / total) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-2 text-[11px]">
                    <span className="w-8 shrink-0 text-ink-600">{star} ★</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-6 shrink-0 text-right text-ink-500">{n}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-ink-500">No verified reviews yet.</p>
          )}

          {summary.dimensionMeans && (
            <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
              {DIMENSIONS.filter((d) => d.key !== 'overall').map((d) => (
                <div key={d.key} className="flex justify-between gap-2 rounded-lg bg-ink-50 px-2 py-1.5">
                  <span className="text-ink-600">{d.label}</span>
                  <span className="font-bold text-ink-800">{summary.dimensionMeans![d.key].toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showMethod && (
        <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-[11px] leading-relaxed text-ink-700">
          <IconInfo width={13} height={13} className="mr-1 inline" />
          {explanation}
        </p>
      )}

      {/* FlowCare-generated themes (computed, not LLM) */}
      <div className="mt-4 rounded-xl border border-ink-100 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">FlowCare review themes</p>
        {flowcareSummary.available ? (
          <div className="mt-1.5 space-y-1 text-xs">
            {flowcareSummary.positives.map((p) => (
              <p key={p.theme} className="text-emerald-800">• {p.theme}: rated 4+ by {p.count} of {flowcareSummary.basedOn} reviewers</p>
            ))}
            {flowcareSummary.negatives.map((n) => (
              <p key={n.theme} className="text-rose-800">• {n.theme}: rated 2 or below by {n.count} of {flowcareSummary.basedOn} reviewers</p>
            ))}
            {flowcareSummary.positives.length === 0 && flowcareSummary.negatives.length === 0 && (
              <p className="text-ink-500">No dimension stands out strongly either way.</p>
            )}
            <p className="pt-1 text-[10px] text-ink-400">
              Counted directly from verified review scores. No language model is involved, and these are not a measure of clinical quality.
            </p>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-ink-500">{flowcareSummary.reason}</p>
        )}
      </div>

      {/* Write a review */}
      <div className="mt-4">
        {eligibility === null && <p className="text-xs text-ink-400">Checking whether you can review this hospital…</p>}
        {eligibility && !eligibility.eligible && (
          <p className="rounded-xl bg-ink-100 px-3 py-2.5 text-xs text-ink-600">
            <IconShield width={13} height={13} className="mr-1 inline" />
            {eligibility.message}
          </p>
        )}
        {eligibility?.eligible && !showForm && (
          <button onClick={() => setShowForm(true)} className="fc-btn-primary text-xs">
            <IconStar width={15} height={15} /> Review your completed visit
          </button>
        )}
        {eligibility?.eligible && showForm && (
          <ReviewForm
            hospitalId={hospitalId}
            appointments={eligibility.eligibleAppointments}
            onDone={(r, message) => {
              setShowForm(false);
              if (r) setReviews((list) => [r, ...list]);
              alert(message);
            }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>

      {/* List */}
      <div className="mt-5 space-y-3">
        {reviews.length === 0 && <p className="text-xs text-ink-500">No published reviews yet.</p>}
        {reviews.map((r) => <ReviewItem key={r.id} review={r} />)}
      </div>
    </section>
  );
}

function ReviewItem({ review }: { review: HospitalReview }) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submitReport = async (reason: string) => {
    const res = await fetch(`/api/reviews/${encodeURIComponent(review.id)}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    const j = await res.json();
    setReporting(false);
    if (res.ok) { setReported(true); setMsg(j.data.message); }
    else setMsg(j.error?.message ?? 'Could not submit the report.');
  };

  return (
    <article className="rounded-xl border border-ink-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="fc-pill bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
          <IconCheck width={12} height={12} /> Verified FlowCare visit
        </span>
        <span className="text-xs font-semibold text-ink-700">{review.authorHandle}</span>
        <span className="fc-pill bg-brand-50 text-brand-800">{review.ratings.overall}.0 ★</span>
        <span className="ml-auto text-[10px] text-ink-400">{new Date(review.createdAt).toLocaleDateString()}</span>
      </div>
      {review.comment && <p className="mt-2 text-xs leading-relaxed text-ink-700">{review.comment}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        {DIMENSIONS.filter((d) => d.key !== 'overall').map((d) => (
          <span key={d.key} className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-600">
            {d.label.split(' ')[0]} {review.ratings[d.key]}
          </span>
        ))}
      </div>
      <div className="mt-2">
        {reported || msg ? (
          <p className="text-[10px] text-ink-500">{msg}</p>
        ) : reporting ? (
          <div className="flex flex-wrap gap-1.5">
            {[['not_my_experience', 'Not a real visit'], ['offensive', 'Offensive'], ['spam_or_advertising', 'Spam'], ['personal_information', 'Personal info'], ['factually_wrong', 'Factually wrong']].map(([v, l]) => (
              <button key={v} onClick={() => submitReport(v)} className="fc-chip-off !min-h-[28px] !py-0.5 !text-[10px]">{l}</button>
            ))}
            <button onClick={() => setReporting(false)} className="text-[10px] text-ink-400 underline">cancel</button>
          </div>
        ) : (
          <button onClick={() => setReporting(true)} className="text-[10px] text-ink-400 underline hover:text-ink-600">Report this review</button>
        )}
      </div>
    </article>
  );
}

function ReviewForm({
  hospitalId, appointments, onDone, onCancel,
}: {
  hospitalId: string;
  appointments: Eligibility['eligibleAppointments'];
  onDone: (review: HospitalReview | null, message: string) => void;
  onCancel: () => void;
}) {
  const [appointmentId, setAppointmentId] = useState(appointments[0]?.id ?? '');
  const [ratings, setRatings] = useState<HospitalReview['ratings']>({ overall: 0, waiting: 0, staff: 0, appointment: 0, facility: 0 });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = DIMENSIONS.every((d) => ratings[d.key] > 0);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/hospitals/${encodeURIComponent(hospitalId)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, ratings, comment: comment.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error?.message ?? 'Could not submit your review.'); return; }
      onDone(j.data.moderation.status === 'published' ? j.data.review : null, j.data.moderation.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <h3 className="text-sm font-bold">Rate your completed visit</h3>
      <label className="fc-label mt-3 block">Which visit?</label>
      <select className="fc-input mt-1" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
        {appointments.map((a) => (
          <option key={a.id} value={a.id}>
            {a.completedAt ? new Date(a.completedAt).toLocaleDateString() : new Date(a.scheduledFor).toLocaleDateString()} — {a.departmentId.split(':dept:')[1] ?? 'visit'}
          </option>
        ))}
      </select>

      <div className="mt-3 space-y-2.5">
        {DIMENSIONS.map((d) => (
          <div key={d.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-ink-800">{d.label}</span>
              <span className="text-[10px] text-ink-400">{d.hint}</span>
            </div>
            <div className="mt-1 flex gap-1.5">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={`${d.label}: ${v} out of 5`}
                  aria-pressed={ratings[d.key] === v}
                  onClick={() => setRatings((r) => ({ ...r, [d.key]: v }))}
                  className={`grid h-10 w-10 place-items-center rounded-xl border text-sm font-bold transition-colors ${
                    ratings[d.key] >= v ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-200 bg-white text-ink-400'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <label className="fc-label mt-3 block" htmlFor="rev-comment">Comment (optional)</label>
      <textarea
        id="rev-comment"
        className="fc-input mt-1 min-h-[88px]"
        maxLength={1500}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="What was the waiting, staff and appointment experience like?"
      />
      <p className="mt-1 text-[10px] text-ink-500">
        Please do not include personal health details, names of individuals, or contact information. Your review is shown
        with initials only.
      </p>

      {error && <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={!complete || busy} className="fc-btn-primary flex-1 text-xs">
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
        <button onClick={onCancel} className="fc-btn-secondary text-xs">Cancel</button>
      </div>
    </div>
  );
}
