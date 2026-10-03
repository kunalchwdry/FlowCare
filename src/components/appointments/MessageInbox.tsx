'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AppointmentMessages } from '@/components/appointments/AppointmentMessages';
import { formatDateTime } from '@/lib/time';
import type { AppointmentMessage } from '@/lib/types';

export interface MessageThread {
  appointmentId: string;
  title: string;
  subtitle: string;
  scheduledFor: string;
  status: string;
  version: number;
  messages: AppointmentMessage[];
}

export function MessageInbox({
  audience,
  threads,
}: {
  audience: 'patient' | 'hospital';
  threads: MessageThread[];
}) {
  const [selectedId, setSelectedId] = useState(threads[0]?.appointmentId ?? '');
  const selected = threads.find((thread) => thread.appointmentId === selectedId) ?? threads[0];

  if (threads.length === 0) {
    return (
      <div className="fc-card p-8 text-center">
        <p className="text-base font-bold text-ink-900">No appointment conversations yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-600">
          {audience === 'patient'
            ? 'Messages from hospitals will be saved here alongside the appointment they belong to.'
            : 'Messages from patients will appear here alongside their appointment.'}
        </p>
        {audience === 'patient' && (
          <Link href="/hospitals" className="fc-btn-primary mt-4 text-sm">Find a hospital</Link>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <section className="fc-card overflow-hidden p-2">
        <div className="px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Conversations</p>
          <p className="mt-0.5 text-[11px] text-ink-500">Saved by appointment</p>
        </div>
        <div className="space-y-1">
          {threads.map((thread) => {
            const active = thread.appointmentId === selected?.appointmentId;
            const unreadStyle = thread.messages.some((m) => m.senderSide !== audience)
              ? 'font-bold text-ink-900'
              : 'font-semibold text-ink-700';
            return (
              <button
                key={thread.appointmentId}
                type="button"
                onClick={() => setSelectedId(thread.appointmentId)}
                className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                  active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-ink-50'
                }`}
              >
                <p className={`truncate text-sm ${unreadStyle}`}>{thread.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-ink-500">{thread.subtitle}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-ink-400">
                  <span>{thread.messages.length} message{thread.messages.length === 1 ? '' : 's'}</span>
                  <span>{formatDateTime(thread.scheduledFor)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selected && (
        <section className="min-w-0">
          <div className="fc-card mb-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700">Appointment conversation</p>
                <h2 className="mt-1 text-lg font-extrabold text-ink-900">{selected.title}</h2>
                <p className="mt-0.5 text-sm text-ink-600">{selected.subtitle}</p>
              </div>
              <Link
                href={audience === 'patient' ? `/appointments/${selected.appointmentId}` : '/hospital/appointments?tab=pending'}
                className="fc-btn-secondary text-xs"
              >
                {audience === 'patient' ? 'Open appointment' : 'Open appointments'}
              </Link>
            </div>
          </div>
          <AppointmentMessages
            appointmentId={selected.appointmentId}
            audience={audience}
            version={selected.version}
            status={selected.status}
            initialMessages={selected.messages}
          />
        </section>
      )}
    </div>
  );
}
