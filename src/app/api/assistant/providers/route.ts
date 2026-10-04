import { listProviders } from '@/lib/ai/providers';
import { env } from '@/lib/env';
import { ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The browser only learns provider metadata and configuration status. It never
 * receives a provider key or chooses credentials for a request.
 */
export async function GET() {
  const groq = listProviders().find((provider) => provider.id === 'groq');
  return ok({
    providers: groq ? [groq] : [],
    defaultProvider: env.aiDefaultProvider(),
    anyConfigured: Boolean(groq?.configured),
    serverManaged: true,
    note: 'FlowCare uses an application-managed Groq key. Users do not need to provide an API key.',
  });
}
