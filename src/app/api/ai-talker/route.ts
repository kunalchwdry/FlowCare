import { NextRequest } from 'next/server';
import type { LiveServerMessage, Session } from '@google/genai';
import { env } from '@/lib/env';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/*  WAV helpers (from the user's original code)                       */
/* ------------------------------------------------------------------ */

interface WavOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function parseMimeType(mimeType: string): WavOptions {
  const [fileType, ...params] = (mimeType || '').split(';').map((s) => s.trim());
  const [, format] = (fileType || '').split('/');
  const opts: WavOptions = {
    numChannels: 1,
    sampleRate: 24000,
    bitsPerSample: 16,
  };

  if (format?.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) opts.bitsPerSample = bits;
  }
  for (const p of params) {
    const [key, value] = p.split('=').map((s) => s.trim());
    if (key === 'rate') {
      const parsedRate = parseInt(value, 10);
      if (!isNaN(parsedRate)) opts.sampleRate = parsedRate;
    }
  }
  return opts;
}

function createWavHeader(dataLength: number, o: WavOptions): Buffer {
  const byteRate = o.sampleRate * o.numChannels * o.bitsPerSample / 8;
  const blockAlign = o.numChannels * o.bitsPerSample / 8;
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(o.numChannels, 22);
  buf.writeUInt32LE(o.sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(o.bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLength, 40);
  return buf;
}

function convertToWav(rawParts: string[], mimeType: string): Buffer {
  const opts = parseMimeType(mimeType);
  const pcmBuffers = rawParts.map((d) => Buffer.from(d, 'base64'));
  const pcm = Buffer.concat(pcmBuffers);
  const header = createWavHeader(pcm.length, opts);
  return Buffer.concat([header, pcm]);
}

const IMMEDIATE_HELP_QUERY = /\b(snake\s*bite|snake has bitten|poison(?:ed|ing)?|anaphylaxis|severe allergic reaction|unconscious|can't breathe|cannot breathe|severe bleeding|heart attack|cardiac attack|cardiac arrest|cardiac emergency|stroke|overdose|suicid(?:e|al)|self[- ]harm)\b/i;
const EMERGENCY_EN = 'This may need urgent medical attention. Call 112 in India or go to the nearest emergency department now. Do not wait for FlowCare to find a routine appointment.';
const EMERGENCY_HI = 'यह तुरंत चिकित्सा सहायता की जरूरत हो सकती है। भारत में 112 पर कॉल करें या अभी निकटतम आपातकालीन विभाग जाएं। FlowCare की नियमित अपॉइंटमेंट खोज का इंतजार न करें।';

/* ------------------------------------------------------------------ */
/*  POST /api/ai-talker — one-shot send → streamed SSE response       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY not configured' },
      { status: 503 },
    );
  }

  const rl = rateLimit(`ai-talker:${clientKey(req)}`, env.aiRateLimitPerMin());
  if (!rl.allowed) {
    return Response.json({ error: 'Too many voice requests. Please wait a moment.' }, { status: 429 });
  }

  let body: { message: string; language?: 'en' | 'hi'; synthesisText?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: 'Empty message' }, { status: 400 });
  }
  if (message.length > 400) {
    return Response.json({ error: 'Message is too long' }, { status: 400 });
  }

  const isHindi = body.language === 'hi';
  const synthesisText = typeof body.synthesisText === 'string' ? body.synthesisText.trim() : '';
  if (synthesisText.length > 700) {
    return Response.json({ error: 'Synthesis text is too long' }, { status: 400 });
  }
  const emergency = IMMEDIATE_HELP_QUERY.test(message);
  const systemPrompt = isHindi
    ? 'You are FlowCare AI, a friendly voice assistant for hospital discovery. Speak only natural, concise Hindi. FlowCare can help find and compare hospitals, departments, accessibility options, and published appointments. Do not diagnose, prescribe, triage, or invent hospital availability. If the user describes an emergency, read the supplied safety notice exactly and add nothing clinical.'
    : 'You are FlowCare AI, a friendly voice assistant for hospital discovery. Speak only natural, concise English. FlowCare can help find and compare hospitals, departments, accessibility options, and published appointments. Do not diagnose, prescribe, triage, or invent hospital availability. If the user describes an emergency, read the supplied safety notice exactly and add nothing clinical.';

  /* We open a fresh Live session per request, send one turn, stream
     the model response back as SSE, then close. This keeps the API
     route stateless while still using the Live API with audio.        */

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      let session: Session | undefined;

      try {
        // Next/Vercel can bundle ws's optional native bufferutil module as an
        // object without its mask function. Force ws's portable implementation
        // before dynamically loading the Live SDK.
        process.env.WS_NO_BUFFER_UTIL = '1';
        const { GoogleGenAI, Modality, MediaResolution } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const responseQueue: LiveServerMessage[] = [];
        const audioParts: string[] = [];

        session = await ai.live.connect({
          model: 'gemini-3.8-live',
          callbacks: {
            onopen() { /* connected */ },
            onmessage(msg: LiveServerMessage) {
              responseQueue.push(msg);
            },
            onerror(e: ErrorEvent) {
              send('error', { message: e.message });
            },
            onclose() { /* session ended */ },
          },
          config: {
            responseModalities: [Modality.AUDIO],
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            outputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
            contextWindowCompression: {
              triggerTokens: '104857',
              slidingWindow: { targetTokens: '52428' },
            },
          },
        });

        const turnText = emergency
          ? `[Read this exact safety notice aloud in ${isHindi ? 'Hindi' : 'English'} and do not add advice]: ${isHindi ? EMERGENCY_HI : EMERGENCY_EN}`
          : synthesisText
            ? `[Read this exact FlowCare response aloud in ${isHindi ? 'Hindi' : 'English'} and do not add or change any claims]: ${synthesisText}`
            : isHindi
              ? `[User language: Hindi. Please reply aloud in spoken Hindi]: ${message}`
              : `[User language: English. Please reply aloud in spoken English]: ${message}`;

        session.sendClientContent({ turns: [turnText] });

        let lastMimeType = 'audio/L16;rate=24000';
        let turnDone = false;
        const startTime = Date.now();

        while (!turnDone) {
          if (Date.now() - startTime > 30000) {
            send('error', { message: 'Gemini Live request timed out after 30s' });
            break;
          }

          const msg = responseQueue.shift();
          if (!msg) {
            await new Promise((r) => setTimeout(r, 40));
            continue;
          }

          if (msg.serverContent?.outputTranscription?.text) {
            send('text-chunk', { text: msg.serverContent.outputTranscription.text });
          }

          if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.text) {
                send('text-chunk', { text: part.text });
              }
              if (part.inlineData?.data) {
                if (part.inlineData.mimeType) {
                  lastMimeType = part.inlineData.mimeType;
                }
                const rawChunk = part.inlineData.data;
                audioParts.push(rawChunk);
                // Immediately stream the raw 24kHz PCM chunk to the client
                send('pcm-chunk', { chunk: rawChunk });
              }
            }
          }

          if (msg.serverContent?.turnComplete) {
            turnDone = true;
          }
        }

        // Send full WAV as fallback and for replay button
        if (audioParts.length > 0) {
          try {
            const wav = convertToWav(audioParts, lastMimeType);
            send('audio-complete', { wav: wav.toString('base64') });
          } catch (wavErr) {
            console.error('WAV conversion failed:', wavErr);
          }
        }

        send('turn-end', {});
      } catch (err) {
        console.error('Gemini Live session error:', err);
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try { session?.close(); } catch { /* ignore */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
