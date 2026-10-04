import { fail } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** User-key validation is retired: FlowCare owns the provider credential. */
export async function POST() {
  return fail(410, 'FlowCare AI uses the application-managed Groq key. User API keys are not needed.');
}
