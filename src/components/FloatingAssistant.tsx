'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { FlowCareMark } from '@/components/Brand';
import { IconClose, IconMic, IconStop } from '@/components/Icons';
import { PcmStreamPlayer } from '@/lib/audio/pcmPlayer';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  audioWav?: string;
}

interface SpeechResultItem { transcript: string }
interface SpeechResultList { length: number; [index: number]: { length: number; [index: number]: SpeechResultItem } }
interface SpeechResultEvent extends Event { results: SpeechResultList }
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type VoiceLanguage = 'en' | 'hi';

type SseEvent = { event: string; data: Record<string, unknown> };

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: 'Hi! I can help you find and compare hospitals, departments, accessibility options, and available appointments.',
};

function parseSseBlock(block: string): SseEvent | null {
  const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? 'message';
  const dataLine = block.match(/^data:\s*(.+)$/m)?.[1]?.trim();
  if (!dataLine) return null;
  try {
    const data = JSON.parse(dataLine) as Record<string, unknown>;
    return { event, data };
  } catch {
    return null;
  }
}

/**
 * The voice bubble keeps the Gemini Live key on the server. Text is sent to
 * /api/ai-talker, PCM audio is streamed back and scheduled gaplessly in the
 * browser, and Replay uses the captured WAV returned by the server.
 */
export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<VoiceLanguage>('en');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const playerRef = useRef<PcmStreamPlayer | null>(null);

  const hindi = language === 'hi';

  useEffect(() => {
    playerRef.current = new PcmStreamPlayer(setPlaying);
    return () => {
      recognitionRef.current?.stop();
      playerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, busy]);

  function updateAssistant(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((message, index) =>
      index.toString() === id ? { ...message, ...patch } : message));
  }

  async function sendMessage(content: string) {
    const clean = content.trim();
    if (!clean || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: clean }];
    const assistantId = String(nextMessages.length);
    setMessages([...nextMessages, { role: 'assistant', content: hindi ? 'जवाब तैयार कर रहा हूँ…' : 'Synthesizing voice response…' }]);
    setDraft('');
    setBusy(true);
    setError(null);
    playerRef.current?.reset();
    await playerRef.current?.ensureContext();

    let replyText = '';
    let audioWav: string | undefined;

    const handleEvent = (incoming: SseEvent) => {
      if (incoming.event === 'text-chunk') {
        const text = typeof incoming.data.text === 'string' ? incoming.data.text : '';
        replyText += text;
        updateAssistant(assistantId, { content: replyText });
      } else if (incoming.event === 'pcm-chunk') {
        const chunk = typeof incoming.data.chunk === 'string' ? incoming.data.chunk : '';
        if (chunk) void playerRef.current?.feed(chunk);
      } else if (incoming.event === 'audio-complete') {
        audioWav = typeof incoming.data.wav === 'string' ? incoming.data.wav : undefined;
      } else if (incoming.event === 'error') {
        const message = typeof incoming.data.message === 'string' ? incoming.data.message : 'Gemini voice could not respond.';
        setError(message);
      } else if (incoming.event === 'turn-end') {
        updateAssistant(assistantId, {
          content: replyText || (hindi ? '🔊 बोलकर जवाब दिया' : '🔊 Spoken reply'),
          audioWav,
        });
        setBusy(false);
      }
    };

    try {
      const response = await fetch('/api/ai-talker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean, language }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `Gemini voice returned HTTP ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (parsed) handleEvent(parsed);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        const parsed = parseSseBlock(buffer);
        if (parsed) handleEvent(parsed);
      }
      setBusy(false);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Gemini voice could not respond.');
      updateAssistant(assistantId, { content: hindi ? 'Gemini से आवाज़ वाला जवाब नहीं मिल सका।' : 'Gemini voice could not respond.' });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function startListening() {
    if (busy || listening || typeof window === 'undefined') return;
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setError(hindi ? 'इस ब्राउज़र में आवाज़ से लिखना उपलब्ध नहीं है। कृपया टाइप करें।' : 'Voice input is not available in this browser. Please type instead.');
      return;
    }

    const recognition = new Constructor();
    recognition.lang = hindi ? 'hi-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (transcript) void sendMessage(transcript);
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error !== 'aborted' && event.error !== 'no-speech') setError(hindi ? 'माइक से आवाज़ नहीं मिल सकी।' : 'I could not hear you. Please try again.');
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    try { recognition.start(); } catch { setListening(false); setError(hindi ? 'माइक शुरू नहीं हो सका।' : 'The microphone could not start.'); }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleLanguage() {
    playerRef.current?.stop();
    setLanguage((current) => current === 'en' ? 'hi' : 'en');
    setError(null);
  }

  function closeAssistant() {
    playerRef.current?.stop();
    stopListening();
    setOpen(false);
  }

  function reset() {
    playerRef.current?.stop();
    setMessages([WELCOME]);
    setDraft('');
    setError(null);
  }

  return (
    <div className="pointer-events-none fixed bottom-[76px] right-4 z-50 sm:bottom-6 sm:right-6">
      {open && (
        <section className="pointer-events-auto mb-3 flex h-[min(560px,calc(100vh-120px))] w-[min(475px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-2xl" aria-label={hindi ? 'FlowCare लाइव वॉइस असिस्टेंट' : 'FlowCare live voice assistant'}>
          <header className="flex items-center gap-2.5 border-b border-ink-200 bg-white px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-sm"><FlowCareMark size={25} /></span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold text-ink-900">FlowCare AI <span className="ml-1 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-700">{hindi ? 'हिंदी' : 'English'}</span></h2>
              <p className="text-xs text-ink-500">{playing ? (hindi ? 'बोल रहा हूँ…' : 'Speaking live…') : 'Live Voice Assistant'}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={toggleLanguage} className="rounded-xl border border-ink-200 px-2.5 py-1.5 text-[11px] font-semibold text-ink-700 hover:bg-ink-50">{hindi ? 'English में बोलें' : 'हिंदी में बोलें'}</button>
              <button type="button" onClick={reset} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-500 hover:bg-ink-50">New</button>
              <button type="button" onClick={closeAssistant} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Close FlowCare assistant"><IconClose width={18} height={18} /></button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white px-5 py-4" aria-live="polite">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'user' ? (
                  <p className="max-w-[82%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-3 text-sm leading-relaxed text-white">{message.content}</p>
                ) : (
                  <div className="max-w-[86%] rounded-2xl rounded-bl-md border border-ink-200 bg-ink-50/60 px-4 py-3 text-sm leading-relaxed text-ink-800">
                    <p><span aria-hidden="true">🎙️</span> <span aria-hidden="true">🔊</span> {message.content} <span className="text-xs text-ink-400">({hindi ? 'बोलकर जवाब दिया' : 'Spoken reply'})</span></p>
                    {message.audioWav && <button type="button" onClick={() => void playerRef.current?.replay(message.audioWav)} className="mt-2 rounded-xl border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">🔊 {hindi ? 'आवाज़ दोबारा सुनें' : 'Replay voice'}</button>}
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="w-fit rounded-2xl rounded-bl-md border border-ink-200 bg-ink-50 px-4 py-3 text-xs text-ink-500">{hindi ? 'Gemini जवाब तैयार कर रहा है…' : 'Gemini is preparing a voice reply…'}</p>}
            {error && <p className="w-fit rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="border-t border-ink-200 bg-white p-4">
            <div className="flex items-end gap-2 rounded-2xl border border-ink-300 bg-white p-1.5 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={1} maxLength={400} placeholder={hindi ? 'अपना सवाल लिखें (बोलकर जवाब मिलेगा)…' : 'Type your question (Gemini will speak)…'} aria-label={hindi ? 'FlowCare को संदेश लिखें' : 'Message FlowCare assistant'} className="max-h-20 min-h-[38px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-ink-900 outline-none placeholder:text-ink-400" />
              <button type="button" onClick={listening ? stopListening : startListening} disabled={busy} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${listening ? 'bg-rose-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-brand-50 hover:text-brand-700'} disabled:cursor-not-allowed disabled:opacity-50`} aria-label={listening ? 'Stop listening' : 'Speak to FlowCare'}>{listening ? <IconStop width={18} height={18} /> : <IconMic width={18} height={18} />}</button>
              <button type="submit" disabled={busy || !draft.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-xl font-bold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400" aria-label="Send message">↑</button>
            </div>
            <p className="mt-2 text-center text-[10px] text-ink-400">{hindi ? 'माइक की अनुमति दें या टाइप करें · Gemini voice connected' : 'Allow microphone access or type · Gemini Live voice connected'}</p>
          </form>
        </section>
      )}

      <button type="button" onClick={() => open ? closeAssistant() : setOpen(true)} className="pointer-events-auto ml-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-500 text-white shadow-xl shadow-brand-500/25 ring-4 ring-white transition hover:-translate-y-0.5 hover:bg-brand-600 focus:outline-none focus:ring-brand-200" aria-label={open ? 'Close FlowCare assistant' : 'Open FlowCare live voice assistant'} aria-expanded={open}>{open ? <IconClose width={25} height={25} /> : <FlowCareMark size={31} title="FlowCare live voice assistant" />}</button>
    </div>
  );
}
