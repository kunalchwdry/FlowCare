import { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROQ_TTS_URL = 'https://api.groq.com/openai/v1/audio/speech';
const DEFAULT_TTS_MODEL = 'canopylabs/orpheus-v1-english';
const DEFAULT_TTS_VOICE = 'hannah';
const MAX_TTS_CHARS = 190;

interface VoiceBody {
  message: string;
  language?: 'en' | 'hi';
  /** The canonical /api/chat reply. The voice route only reads this text. */
  synthesisText?: string;
}

interface WavPart {
  data: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
}

function splitSpeechText(text: string): string[] {
  const sentences = text.match(/[^.!?।]+[.!?।]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (current && `${current} ${word}`.length > MAX_TTS_CHARS) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, MAX_TTS_CHARS)];
}

function parseWav(buffer: Buffer): WavPart {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('groq_tts_not_wav');
  }

  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let data: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(buffer.length, start + size);
    if (id === 'fmt ' && end - start >= 16) {
      audioFormat = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
    } else if (id === 'data') {
      data = buffer.subarray(start, end);
      break;
    }
    offset = start + size + (size % 2);
  }

  if (!data) throw new Error('groq_tts_missing_audio');
  return { data, sampleRate, channels, bitsPerSample, audioFormat };
}

function createWav(parts: WavPart[]): Buffer {
  if (!parts.length) throw new Error('groq_tts_empty_audio');
  const first = parts[0];
  const pcm = Buffer.concat(parts.map((part) => part.data));
  const blockAlign = first.channels * first.bitsPerSample / 8;
  const byteRate = first.sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(first.audioFormat, 20);
  header.writeUInt16LE(first.channels, 22);
  header.writeUInt32LE(first.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(first.bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function generateGroqWav(apiKey: string, text: string): Promise<Buffer> {
  const chunks = splitSpeechText(text);
  const wavParts: WavPart[] = [];
  const model = process.env.GROQ_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const voice = process.env.GROQ_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;

  for (const chunk of chunks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.aiTimeoutMs());
    try {
      const response = await fetch(GROQ_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, voice, input: chunk, response_format: 'wav' }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`groq_tts_http_${response.status}`);
      wavParts.push(parseWav(Buffer.from(await response.arrayBuffer())));
    } finally {
      clearTimeout(timeout);
    }
  }

  return createWav(wavParts);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 });
  }

  const rl = rateLimit(`groq-tts:${clientKey(req)}`, env.aiRateLimitPerMin());
  if (!rl.allowed) {
    return Response.json({ error: 'Too many voice requests. Please wait a moment.' }, { status: 429 });
  }

  let body: VoiceBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = body.message?.trim();
  const language = body.language === 'hi' ? 'hi' : 'en';
  const text = typeof body.synthesisText === 'string' && body.synthesisText.trim()
    ? body.synthesisText.trim()
    : message;

  if (!message || !text) return Response.json({ error: 'Empty message' }, { status: 400 });
  if (message.length > 400 || text.length > 700) {
    return Response.json({ error: 'Message is too long' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Groq's current Orpheus hosted TTS models support English and Arabic,
        // not Hindi. Never silently send Hindi text to an English voice.
        if (language === 'hi') {
          send('error', {
            code: 'hindi_tts_unavailable',
            message: 'Groq voice currently supports English, not Hindi. FlowCare will use an installed Hindi browser voice if available.',
          });
          send('turn-end', {});
          return;
        }

        const wav = await generateGroqWav(apiKey, text);
        send('audio-complete', { wav: wav.toString('base64') });
        send('turn-end', {});
      } catch (error) {
        console.error('Groq TTS error:', error);
        send('error', {
          message: error instanceof Error ? error.message : 'Groq voice could not respond.',
        });
        send('turn-end', {});
      } finally {
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
