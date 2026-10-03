import { NextRequest } from 'next/server';
import { z } from 'zod';
import { POST as assistantPost } from '@/app/api/assistant/route';
import { handleError, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ChatBody = z.object({
  message: z.string().trim().min(1).max(400),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1200),
  }).strict()).max(12).default([]),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  page: z.number().int().min(1).max(50).optional(),
}).strict();

/**
 * Public chatbot contract. The existing assistant search implementation stays
 * intact behind this route, while the browser talks to one stable, generic
 * chat endpoint. Gemini and any future FlowCare model remain server-only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = ChatBody.parse(await readJson(req, 12000));
    const rewritten = new NextRequest(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({
        query: body.message,
        history: body.history,
        location: body.location,
        page: body.page,
      }),
    });
    return assistantPost(rewritten);
  } catch (e) {
    return handleError(e);
  }
}
