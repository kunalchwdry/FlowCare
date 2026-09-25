import Link from 'next/link';
import type { Metadata } from 'next';
import { FlowCareLogo, FlowCareMark } from '@/components/Brand';
import {
  IconCalendar, IconCompare, IconHeart, IconMap, IconSearch, IconShield, IconSparkles,
} from '@/components/Icons';

export const metadata: Metadata = {
  title: 'FlowCare — Smarter healthcare, less waiting',
  description:
    'Discover hospitals, see how busy they are before you travel, book an appointment and follow your place in the queue.',
};

/* The patient journey, used by the "How FlowCare works" rail. */
const FLOW = [
  { t: 'Discover', d: 'Hospitals near you, by area or specialty.', Icon: IconSearch },
  { t: 'Check queue', d: 'See how busy it is before you leave home.', Icon: IconMap },
  { t: 'Book a slot', d: 'Request a session the hospital has opened.', Icon: IconCalendar },
  { t: 'Check in', d: 'Arrive prepared, with the right documents.', Icon: IconShield },
  { t: 'Track', d: 'Follow your position while you wait.', Icon: IconSparkles },
  { t: 'Consult', d: 'Then rate the visit you actually attended.', Icon: IconHeart },
];

const PATIENT_FEATURES = [
  { t: 'Hospital discovery', d: 'Search by name, area, department or plain language across every published facility.' },
  { t: 'Queue visibility', d: 'Where a hospital reports its queue, you see it. Where it does not, FlowCare says "unknown" instead of guessing.' },
  { t: 'Appointment booking', d: 'Request a real session the hospital has opened, and get a reference you can quote at the desk.' },
  { t: 'Queue tracking', d: 'Your position, how many people are ahead, and a timeline from booked to completed.' },
  { t: 'Verified-visit ratings', d: 'Only patients who actually completed a visit can review it. No anonymous drive-by scores.' },
  { t: 'AI hospital assistant', d: 'Describe what you need in your own words; it turns that into filters and shows its evidence.' },
];

const HOSPITAL_FEATURES = [
  { t: 'Queue management', d: 'Move patients through waiting, in consultation and completed, with an audit trail behind every change.' },
  { t: 'Staff dashboard', d: 'Today\u2019s load at a glance: waiting, in progress, completed, average wait.' },
  { t: 'Patient check-in', d: 'Confirm arrivals against booked sessions so the queue reflects who is actually present.' },
  { t: 'Appointment management', d: 'Requested, confirmed, completed and cancelled, separated rather than lumped together.' },
  { t: 'Capacity control', d: 'Sessions carry a real capacity. When it is full, it stops accepting requests.' },
  { t: 'Roles and approvals', d: 'Receptionist, doctor and administrator see different things. Access is granted, never assumed.' },
];

const WHY = [
  { t: 'Less waiting', d: 'Choosing a quieter clinic, or a better hour, beats sitting in a corridor.', Icon: IconCalendar },
  { t: 'Better visibility', d: 'Every fact shows where it came from and when it was last checked.', Icon: IconShield },
  { t: 'Smarter decisions', d: 'Compare facilities side by side on the things that actually differ.', Icon: IconCompare },
  { t: 'Better operations', d: 'Hospitals get a queue they can steer instead of a waiting room they absorb.', Icon: IconSparkles },
  { t: 'Patient-centric', d: 'No dark patterns, no invented ratings, no "best hospital" leaderboard.', Icon: IconHeart },
];

function SectionHead({
  eyebrow, title, blurb, center = false,
}: { eyebrow: string; title: string; blurb?: string; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="fc-eyebrow">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">{title}</h2>
      {blurb && <p className="mt-3 text-[15px] leading-relaxed text-ink-600">{blurb}</p>}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="space-y-14 pb-10 sm:space-y-20">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-card">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 h-[26rem] w-[26rem] rounded-full bg-brand-100/60 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-24 h-[22rem] w-[22rem] rounded-full bg-brand-50 blur-3xl"
        />
        <div className="relative grid items-center gap-10 px-6 py-12 sm:px-10 sm:py-16 lg:grid-cols-[1.05fr_.95fr] lg:px-14">
          <div className="animate-fade-up">
            <span className="fc-pill-brand">
              <FlowCareMark size={14} /> Outpatient discovery &amp; appointments
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight text-ink-900 sm:text-5xl">
              Smarter healthcare.
              <br />
              <span className="text-brand-600">Less waiting.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-600 sm:text-lg">
              Find the right hospital, see how busy it is before you travel, request an appointment
              and follow your place in the queue — instead of losing a day to a waiting room.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/hospitals" className="fc-btn-primary fc-btn-lg">
                <IconSearch width={18} height={18} /> Find a hospital
              </Link>
              <Link href="/get-started" className="fc-btn-secondary fc-btn-lg">
                Get started
              </Link>
            </div>
            <div className="mt-4">
              <Link
                href="/staff/login"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 underline-offset-4 hover:text-brand-700 hover:underline"
              >
                I&rsquo;m hospital staff →
              </Link>
            </div>
          </div>

          {/* Illustrative product panel. Deliberately schematic, not a fake
              screenshot: it shows the shape of the queue view without
              implying a specific hospital's live numbers. */}
          <div className="relative animate-scale-in">
            <div className="fc-card overflow-hidden p-5 shadow-pop">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Your place in the queue</p>
                <span className="fc-pill-success">Checked in</span>
              </div>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-5xl font-extrabold leading-none text-brand-600">#7</span>
                <span className="pb-1 text-sm text-ink-500">of 31 today</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-ink-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Ahead of you</p>
                  <p className="mt-1 text-xl font-bold text-ink-900">6</p>
                </div>
                <div className="rounded-xl bg-ink-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Typical wait</p>
                  <p className="mt-1 text-xl font-bold text-ink-900">~25 min</p>
                </div>
              </div>
              <ol className="mt-5 space-y-2.5">
                {['Booked', 'Checked in', 'Waiting', 'Your turn', 'Consultation'].map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        i <= 2 ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={`text-sm ${i <= 2 ? 'font-semibold text-ink-900' : 'text-ink-400'}`}>{s}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-500">
                Illustration of the queue view. FlowCare only shows a live position when the hospital
                is actually reporting one.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- how it works */}
      <section>
        <SectionHead
          center
          eyebrow="How FlowCare works"
          title="From search to consultation"
          blurb="Six steps, the same whether you are booking for yourself or for a family member."
        />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map(({ t, d, Icon }, i) => (
            <li key={t} className="fc-card fc-card-hover p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <Icon width={19} height={19} />
                </span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Step {i + 1}</p>
                  <h3 className="mt-0.5 text-base font-bold text-ink-900">{t}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600">{d}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------- patients/hospitals */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="fc-section">
          <span className="fc-pill-brand">For patients</span>
          <h2 className="mt-3 text-xl font-extrabold tracking-tight text-ink-900">
            Know before you go
          </h2>
          <ul className="mt-5 space-y-4">
            {PATIENT_FEATURES.map(({ t, d }) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold text-ink-900">{t}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-600">{d}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/get-started" className="fc-btn-primary mt-6 text-sm">Create a patient account</Link>
        </div>

        <div className="fc-section">
          <span className="fc-pill-muted">For hospitals</span>
          <h2 className="mt-3 text-xl font-extrabold tracking-tight text-ink-900">
            A queue you can steer
          </h2>
          <ul className="mt-5 space-y-4">
            {HOSPITAL_FEATURES.map(({ t, d }) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-400" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold text-ink-900">{t}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-600">{d}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/staff/register" className="fc-btn-secondary mt-6 text-sm">Register your hospital team</Link>
        </div>
      </section>

      {/* ------------------------------------------------------------ why */}
      <section>
        <SectionHead
          center
          eyebrow="Why FlowCare"
          title="Built to be trusted, not just used"
          blurb="Healthcare software earns trust by admitting what it does not know. That principle shows up in every screen."
        />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WHY.map(({ t, d, Icon }) => (
            <div key={t} className="fc-card fc-card-hover p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <Icon width={19} height={19} />
              </span>
              <h3 className="mt-3.5 text-base font-bold text-ink-900">{t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- cta */}
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-6 py-12 text-center shadow-pop sm:px-10 sm:py-16">
        <FlowCareLogo size="lg" tone="inverse" className="justify-center" />
        <h2 className="mt-6 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          Start with the hospital, not the paperwork.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/85">
          Browse without an account. Create one when you want to save a hospital, request an
          appointment or review a visit you attended.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/hospitals" className="fc-btn fc-btn-lg bg-white text-brand-700 hover:bg-brand-50">
            <IconSearch width={18} height={18} /> Find a hospital
          </Link>
          <Link
            href="/get-started"
            className="fc-btn fc-btn-lg border border-white/35 bg-white/10 text-white hover:bg-white/20"
          >
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
