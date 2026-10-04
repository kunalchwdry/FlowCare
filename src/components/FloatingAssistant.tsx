'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { FlowCareMark } from '@/components/Brand';
import { IconClose, IconMic, IconStop } from '@/components/Icons';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SpeechResultItem {
  transcript: string;
}

interface SpeechResultList {
  length: number;
  [index: number]: { length: number; [index: number]: SpeechResultItem };
}

interface SpeechResultEvent extends Event {
  results: SpeechResultList;
}

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

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: 'Hi! I can help you find and compare hospitals, departments, accessibility options, and available appointments.',
};

function speechChunks(text: string, maxLength = 180): string[] {
  const sentences = text.match(/[^.!?।]+[.!?।]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      const words = sentence.split(/\s+/);
      for (const word of words) {
        if (current && `${current} ${word}`.length > maxLength) {
          chunks.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      continue;
    }
    if (current && `${current} ${sentence}`.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

/**
 * FlowCare's single assistant entry point. Gemini handles the healthcare
 * search intent on /api/chat; the browser only provides optional microphone
 * input and spoken playback for this compact bubble.
 */
export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<VoiceLanguage>('en');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const speechRunRef = useRef(0);

  const hindi = language === 'hi';

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, busy]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    speechRunRef.current += 1;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  function stopSpeaking() {
    speechRunRef.current += 1;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }

  function pickVoice(lang: VoiceLanguage): SpeechSynthesisVoice | undefined {
    const voices = voicesRef.current;
    const preferred = lang === 'hi'
      ? ['hi-IN', 'hi']
      : ['en-IN', 'en-GB', 'en-US', 'en'];
    return preferred.reduce<SpeechSynthesisVoice | undefined>((selected, wanted) =>
      selected ?? voices.find((voice) => voice.lang.toLowerCase() === wanted.toLowerCase())
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(`${wanted.toLowerCase()}-`)), undefined);
  }

  function speak(text: string, lang = language) {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text.trim()) return;
    stopSpeaking();
    const run = speechRunRef.current;
    const chunks = speechChunks(text);
    const voice = pickVoice(lang);
    if (lang === 'hi' && !voice) {
      setError(lang === 'hi'
        ? 'इस ब्राउज़र में हिंदी आवाज़ इंस्टॉल नहीं है। Windows में Hindi speech voice इंस्टॉल करें और Replay voice दबाएं।'
        : 'Hindi speech is not installed in this browser. Install a Hindi speech voice in Windows, then press Replay voice.');
      return;
    }
    let index = 0;

    const playNext = () => {
      if (run !== speechRunRef.current || index >= chunks.length) return;
      const utterance = new SpeechSynthesisUtterance(chunks[index++]);
      utterance.lang = voice?.lang ?? (lang === 'hi' ? 'hi-IN' : 'en-IN');
      if (voice) utterance.voice = voice;
      utterance.rate = 0.88;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => window.setTimeout(playNext, 60);
      utterance.onerror = (event) => {
        if (event.error !== 'canceled' && event.error !== 'interrupted') window.setTimeout(playNext, 80);
      };
      window.speechSynthesis.speak(utterance);
    };
    playNext();
  }

  async function sendMessage(content: string) {
    const clean = content.trim();
    if (!clean || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: clean }];
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          history: messages.slice(-10),
          location: null,
          language,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? `The assistant returned HTTP ${response.status}.`);
      }
      const reply = String(payload.data.reply ?? 'I could not understand that request.');
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
      speak(reply);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The assistant could not respond.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function startListening() {
    if (busy || listening) return;
    if (typeof window === 'undefined') return;

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
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
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(hindi ? 'माइक से आवाज़ नहीं मिल सकी। कृपया फिर कोशिश करें।' : 'I could not hear you. Please try again.');
      }
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setError(hindi ? 'माइक शुरू नहीं हो सका। कृपया टाइप करें।' : 'The microphone could not start. Please type instead.');
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function reset() {
    stopSpeaking();
    stopListening();
    setMessages([WELCOME]);
    setDraft('');
    setError(null);
  }

  function toggleLanguage() {
    stopSpeaking();
    setLanguage((current) => current === 'en' ? 'hi' : 'en');
    setError(null);
  }

  function closeAssistant() {
    stopSpeaking();
    stopListening();
    setOpen(false);
  }

  return (
    <div className="pointer-events-none fixed bottom-[76px] right-4 z-50 sm:bottom-6 sm:right-6">
      {open && (
        <section
          className="pointer-events-auto mb-3 flex h-[min(560px,calc(100vh-120px))] w-[min(475px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-2xl"
          aria-label={hindi ? 'FlowCare लाइव वॉइस असिस्टेंट' : 'FlowCare live voice assistant'}
        >
          <header className="flex items-center gap-2.5 border-b border-ink-200 bg-white px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-sm">
              <FlowCareMark size={25} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold text-ink-900">FlowCare AI <span className="ml-1 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-700">{hindi ? 'हिंदी' : 'English'}</span></h2>
              <p className="text-xs text-ink-500">{hindi ? 'लाइव वॉइस असिस्टेंट' : 'Live Voice Assistant'}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={toggleLanguage} className="rounded-xl border border-ink-200 px-2.5 py-1.5 text-[11px] font-semibold text-ink-700 hover:bg-ink-50">
                {hindi ? 'English में बोलें' : 'हिंदी में बोलें'}
              </button>
              <button type="button" onClick={closeAssistant} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Close FlowCare assistant">
                <IconClose width={18} height={18} />
              </button>
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
                    <button type="button" onClick={() => speak(message.content)} className="mt-2 rounded-xl border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                      🔊 {hindi ? 'आवाज़ दोबारा सुनें' : 'Replay voice'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="w-fit rounded-2xl rounded-bl-md border border-ink-200 bg-ink-50 px-4 py-3 text-xs text-ink-500">{hindi ? 'FlowCare जवाब खोज रहा है…' : 'FlowCare is checking…'}</p>}
            {error && <p className="w-fit rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="border-t border-ink-200 bg-white p-4">
            <div className="flex items-end gap-2 rounded-2xl border border-ink-300 bg-white p-1.5 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={1}
                maxLength={400}
                placeholder={hindi ? 'अपना सवाल लिखें (बोलकर जवाब मिलेगा)…' : 'Type your question (you can also speak)…'}
                aria-label={hindi ? 'FlowCare को संदेश लिखें' : 'Message FlowCare assistant'}
                className="max-h-20 min-h-[38px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-ink-900 outline-none placeholder:text-ink-400"
              />
              <button type="button" onClick={listening ? stopListening : startListening} disabled={busy} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${listening ? 'bg-rose-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-brand-50 hover:text-brand-700'} disabled:cursor-not-allowed disabled:opacity-50`} aria-label={listening ? 'Stop listening' : 'Speak to FlowCare'}>
                {listening ? <IconStop width={18} height={18} /> : <IconMic width={18} height={18} />}
              </button>
              <button type="submit" disabled={busy || !draft.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-xl font-bold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400" aria-label="Send message">↑</button>
            </div>
            <p className="mt-2 text-center text-[10px] text-ink-400">{hindi ? 'माइक की अनुमति दें या टाइप करें · FlowCare चिकित्सा सलाह नहीं देता' : 'Allow microphone access or type · FlowCare does not diagnose'}</p>
          </form>
        </section>
      )}

      <button type="button" onClick={() => open ? closeAssistant() : setOpen(true)} className="pointer-events-auto ml-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-500 text-white shadow-xl shadow-brand-500/25 ring-4 ring-white transition hover:-translate-y-0.5 hover:bg-brand-600 focus:outline-none focus:ring-brand-200" aria-label={open ? 'Close FlowCare assistant' : 'Open FlowCare live voice assistant'} aria-expanded={open}>
        {open ? <IconClose width={25} height={25} /> : <FlowCareMark size={31} title="FlowCare live voice assistant" />}
      </button>
    </div>
  );
}
