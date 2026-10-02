import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, Stat, NoData } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { summariseReviews } from '@/lib/hospital/portalData';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reviews — FlowCare hospital portal' };

const DIMENSIONS = [
  ['overall', 'Overall'],
  ['waiting', 'Waiting'],
  ['staff', 'Staff'],
  ['appointment', 'Appointment'],
  ['facility', 'Facility'],
] as const;

/**
 * Reviews for this hospital.
 *
 * Read-and-report only. There is no control here to edit a rating, change
 * a patient's words, or remove a review for being unflattering — those
 * would turn a feedback channel into a marketing one, and a reader could
 * no longer trust what they see.
 *
 * Reporting a review routes it to the existing moderation queue, where a
 * person decides. AI may help flag spam; it does not get the final say.
 */
export default async function HospitalReviews() {
  const gate = await requireHospitalPermission('reviews:moderate', '/hospital/reviews');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden')
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/reviews" title="Reviews" />;

  const { actor } = gate;
  const repo = await getRepo();
  const [hospital, reviews] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.listReviews({ hospitalId: actor.hospitalId }),
  ]);
  const stats = summariseReviews(reviews);
  const published = reviews.filter((r) => r.status === 'published');

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/reviews"
      title="Reviews"
      subtitle="From patients with a completed visit here. FlowCare reviews are separate from Google ratings."
    >
      {stats.count === 0 ? (
        <NoData what="Reviews appear once a patient completes a visit here and chooses to leave one." />
      ) : (
        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {DIMENSIONS.map(([key, label]) => {
            const v = stats[key];
            return (
              <Stat
                key={key}
                label={label}
                value={v === null ? '—' : `${v}`}
                tone={v === null ? 'muted' : 'default'}
                hint={v === null ? 'Not rated yet' : `of 5 · ${stats.count} review${stats.count === 1 ? '' : 's'}`}
              />
            );
          })}
        </section>
      )}

      <div className="mt-4 rounded-xl border border-ink-200 bg-white p-4">
        <p className="text-sm font-semibold text-ink-800">What you can and cannot do here</p>
        <ul className="mt-2 space-y-1 text-sm text-ink-600">
          <li>• Read every published review for this hospital, with its rating breakdown.</li>
          <li>• Report a review you believe breaks the rules — spam, abuse, or not a real visit.</li>
          <li>
            • You cannot edit a rating, change a patient&apos;s words, or delete a review for
            being negative. A reported review goes to a human moderator, not to you.
          </li>
        </ul>
      </div>

      {published.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-ink-700">No reviews yet</p>
          <p className="mt-1 text-xs text-ink-500">
            Only patients whose visit here was completed can leave one, so reviews follow real
            appointments rather than arriving on their own.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {published.map((r) => (
            <li key={r.id} className="rounded-xl border border-ink-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink-900">{r.authorHandle}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                  Verified visit
                </span>
                <span className="ml-auto text-xs text-ink-500">
                  {formatDate(r.createdAt)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {DIMENSIONS.map(([key, label]) => {
                  const v = r.ratings?.[key];
                  if (typeof v !== 'number') return null;
                  return (
                    <span key={key} className="rounded-lg bg-ink-100 px-2 py-0.5 text-[11px] text-ink-700">
                      {label} {v}/5
                    </span>
                  );
                })}
              </div>
              {r.comment && <p className="mt-2 text-sm text-ink-700">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-ink-500">
        FlowCare does not combine these into a single quality score, and does not rank hospitals
        against each other. Waiting times and staff manner are experience measures, not clinical
        ones, and presenting them as a verdict on care would be misleading.
      </p>
    </HospitalShell>
  );
}
