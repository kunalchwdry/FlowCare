'use client';

import { useMemo, useState } from 'react';
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
  const [query, setQuery] = useState('');
  const withMessages = threads.filter((thread) => thread.messages.length > 0).length;
  const [filter, setFilter] = useState<'activity' | 'all'>(withMessages > 0 ? 'activity' : 'all');

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (filter === 'activity' && thread.messages.length === 0) return false;
      if (!needle) return true;
      return [
        thread.title,
        thread.subtitle,
        thread.appointmentId,
        thread.scheduledFor,
        thread.status,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [filter, query, threads]);

  const selected = visibleThreads.find((thread) => thread.appointmentId === selectedId) ?? visibleThreads[0];

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
    <div className="space-y-3">
      <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950">
        <p className="font-bold">Open the same appointment on both sides</p>
        <p className="mt-0.5 text-xs leading-relaxed text-brand-900">
          Messages are attached to the appointment date and time, not only to the hospital. Use the search box if you have more than one appointment.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[16rem] flex-1">
          <span className="sr-only">Search conversations</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={audience === 'hospital'
              ? 'Search patient, department, date or appointment ID'
              : 'Search hospital, department, date or appointment ID'}
            className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <div className="flex rounded-lg border border-ink-300 bg-white p-0.5" role="group" aria-label="Conversation filter">
          <button
            type="button"
            onClick={() => setFilter('activity')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${filter === 'activity' ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50'}`}
          >
            With messages ({withMessages})
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${filter === 'all' ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50'}`}
          >
            All appointments ({threads.length})
          </button>
        </div>
      </div>

      {visibleThreads.length === 0 ? (
        <div className="fc-card p-8 text-center">
          <p className="text-sm font-bold text-ink-900">No matching appointment</p>
          <p className="mt-1 text-xs text-ink-500">
            Clear the search or choose “All appointments” to start a new conversation.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <section className="fc-card overflow-hidden p-2">
            <div className="px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Conversations</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {filter === 'activity' ? 'Showing appointments with saved messages' : 'Saved by appointment'}
              </p>
            </div>
            <div className="space-y-1">
              {visibleThreads.map((thread) => {
                const active = thread.appointmentId === selected?.appointmentId;
                const hasMessages = thread.messages.length > 0;
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
                    <div className="flex items-start justify-between gap-2">
                      <p className={`min-w-0 truncate text-sm ${unreadStyle}`}>{thread.title}</p>
                      {hasMessages && (
                        <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-800">
                          {thread.messages.length}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-ink-500">{thread.subtitle}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-ink-400">
                      <span>{hasMessages ? 'Saved messages' : 'No messages yet'}</span>
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
                    <p className="mt-1 text-xs font-semibold text-ink-500">
                      {formatDateTime(selected.scheduledFor)} · Appointment {selected.appointmentId.slice(0, 8)}…
                    </p>
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
      )}
    </div>
  );
}
