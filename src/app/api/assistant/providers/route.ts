import { listProviders } from '@/lib/ai/providers';
import { ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The client only needs to know whether the application-owned Gemini provider
 * is configured. It must never choose a vendor or receive any key material.
 */
export async function GET() {
  const gemini = listProviders().find((p) => p.id === 'gemini');
  return ok({
    providers: gemini ? [{ ...gemini, configured: gemini.configured }] : [],
    defaultProvider: 'gemini',
    anyConfigured: Boolean(gemini?.configured),
    serverManaged: true,
    note: 'FlowCare uses one application-managed Gemini key. Users do not need to provide an API key.',
  });
}
