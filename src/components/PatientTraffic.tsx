'use client';

import { useEffect, useState } from 'react';
import type { PatientTrafficSnapshot, TrafficLevel } from '@/lib/traffic/traffic';
import { formatDateTime } from '@/lib/time';

const levelClasses: Record<TrafficLevel, string> = {
  LOW: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  MODERATE: 'bg-amber-50 text-amber-900 ring-amber-200',
  HIGH: 'bg-rose-50 text-rose-800 ring-rose-200',
};

function Updated({ traffic }: { traffic: PatientTrafficSnapshot }) {
  if (!traffic.available) {
    return <span className="text-ink-500">Traffic unavailable</span>;
  }
  return (
    <span className="text-ink-500">
      Updated {traffic.updatedAt ? formatDateTime(traffic.updatedAt) : 'just now'}
    </span>
  );
}

/** Compact, patient-safe summary for a discovery card. */
export function TrafficSummary({ traffic }: { traffic?: PatientTrafficSnapshot }) {
  if (!traffic?.available) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-3 py-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-ink-700">Patient traffic</span>
          <span className="text-ink-500">Traffic unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-ink-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-xs font-bold text-ink-800">Patient traffic</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${levelClasses[traffic.trafficLevel!]}`}>
          {traffic.trafficLevel}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-600">
        <span><strong className="text-ink-900">{traffic.waitingCount}</strong> waiting</span>
        {traffic.inConsultationCount !== null && <span><strong className="text-ink-900">{traffic.inConsultationCount}</strong> in consultation</span>}
        <span>{traffic.estimatedWaitMinutes === null ? 'Wait time unavailable' : `~${traffic.estimatedWaitMinutes} min estimated wait`}</span>
      </div>
      <p className="mt-1 text-[10px]"><Updated traffic={traffic} /></p>
    </div>
  );
}

/** Detailed aggregate for a hospital queue reader, or a single patient profile. */
export function PatientTrafficPanel({
  traffic: initialTraffic,
  hospitalId,
  detailed = false,
  autoRefresh = false,
  hospitalPortal = false,
}: {
  traffic?: PatientTrafficSnapshot;
  hospitalId: string;
  detailed?: boolean;
  autoRefresh?: boolean;
  /** Uses the authenticated membership scope for hospital refreshes. */
  hospitalPortal?: boolean;
}) {
  const [traffic, setTraffic] = useState(initialTraffic);

  useEffect(() => {
    setTraffic(initialTraffic);
  }, [initialTraffic]);

  useEffect(() => {
    if (!autoRefresh) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const endpoint = hospitalPortal
          ? '/api/hospital/traffic'
          : `/api/patient-traffic?hospitalIds=${encodeURIComponent(hospitalId)}`;
        const res = await fetch(endpoint, { cache: 'no-store' });
        const json = await res.json();
        const next = json?.data?.traffic?.find((item: PatientTrafficSnapshot) => item.hospitalId === hospitalId);
        if (!disposed && next) setTraffic(next);
      } catch {
        // Keep the last known aggregate visible; the timestamp tells the user
        // when it was observed and the next interval retries.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [autoRefresh, hospitalId, hospitalPortal]);

  if (!traffic?.available) {
    return (
      <section className="rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 p-4" role="status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink-800">Patient traffic</h2>
          <span className="text-xs font-semibold text-ink-500">Traffic unavailable</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          FlowCare has no current appointment traffic data for this hospital. No queue size or wait time is being estimated.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-4" aria-label="Patient traffic">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Patient traffic</p>
          <h2 className="mt-0.5 text-base font-bold text-ink-900">Today&apos;s appointment queue</h2>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${levelClasses[traffic.trafficLevel!]}`}>
          {traffic.trafficLevel}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Metric label="Waiting" value={String(traffic.waitingCount)} />
        <Metric label="In consultation" value={String(traffic.inConsultationCount)} />
        <Metric label="Completed today" value={String(traffic.completedToday)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
        <span><strong className="text-ink-900">{traffic.estimatedWaitMinutes === null ? 'Wait time unavailable' : `~${traffic.estimatedWaitMinutes} min`}</strong> estimated average wait</span>
        <Updated traffic={traffic} />
      </div>

      {detailed && traffic.byDepartment.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">By department</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {traffic.byDepartment.map((department) => (
              <div key={department.departmentId} className="rounded-xl bg-ink-50 px-3 py-2 text-xs">
                <p className="font-semibold text-ink-800">{department.departmentName ?? 'Department'}</p>
                <p className="mt-1 text-ink-600">
                  {department.waitingCount} waiting · {department.inConsultationCount} consulting · {department.completedToday} completed
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {detailed && traffic.byProvider.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">By provider</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {traffic.byProvider.map((provider) => (
              <div key={provider.providerId} className="rounded-xl bg-ink-50 px-3 py-2 text-xs">
                <p className="font-semibold text-ink-800">{provider.providerName ?? 'Provider'}</p>
                <p className="mt-1 text-ink-600">
                  {provider.waitingCount} waiting · {provider.inConsultationCount} consulting · {provider.completedToday} completed
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
