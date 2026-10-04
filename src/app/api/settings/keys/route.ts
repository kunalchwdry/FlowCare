import { fail, ok } from '@/lib/http';
import { listProviders } from '@/lib/ai/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * API-key management remains intentionally retired. The assistant uses the
 * application's server-side Groq credential; user credentials are neither
 * required nor accepted.
 */
export async function GET() {
  const groq = listProviders().find((provider) => provider.id === 'groq');
  return ok({
    serverManaged: true,
    provider: 'groq',
    configured: Boolean(groq?.configured),
    message: 'FlowCare AI is managed by the application. Users do not need an API key.',
  });
}

export async function POST() {
  return fail(410, 'FlowCare AI uses the application-managed Groq key. User API keys are not needed.');
}

export async function DELETE() {
  return fail(410, 'FlowCare AI uses the application-managed Groq key. User API keys are not stored.');
}
