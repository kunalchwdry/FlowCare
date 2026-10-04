import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Never return GROQ_API_KEY to the browser. Voice requests are proxied through
 * /api/ai-talker so the secret remains server-side. */
export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.GROQ_API_KEY?.trim()),
    provider: 'groq',
    hindiTts: false,
  });
}
