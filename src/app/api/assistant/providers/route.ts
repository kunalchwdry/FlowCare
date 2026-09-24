import { listProviders } from '@/lib/ai/providers';
import { env } from '@/lib/env';
import { ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exposes provider ids/labels and a configured boolean. Never any key material. */
export async function GET() {
  const providers = listProviders();
  return ok({
    providers,
    defaultProvider: env.aiDefaultProvider(),
    anyConfigured: providers.some((p) => p.configured),
    fallbackNote:
      'When no provider is configured, or a provider fails, FlowCare uses its own deterministic query parser. Search always works.',
  });
}
