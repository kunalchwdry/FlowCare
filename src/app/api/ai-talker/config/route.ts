import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Never return GEMINI_API_KEY to the browser. The voice session is proxied
 * through /api/ai-talker so the secret stays server-side. */
export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.GEMINI_API_KEY?.trim()) });
}
