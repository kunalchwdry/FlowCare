import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteUserKey, listUserKeys, saveUserKey, SUPPORTED_PROVIDERS } from '@/lib/ai/userKeys';
import { vaultAvailable } from '@/lib/crypto/keyvault';
import { listProviders } from '@/lib/ai/providers';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAuth() {
  const sb = await getSupabaseServerClient();
  if (!sb) return { error: fail(503, 'Supabase is not configured on this server.') };
  const { data } = await sb.auth.getUser();
  if (!data.user) return { error: fail(401, 'Sign in to manage your API keys.') };
  return { userId: data.user.id };
}

/** Masked metadata only. This endpoint can never return key material. */
export async function GET() {
  try {
    const auth = await requireAuth();
    if ('error' in auth) return auth.error;

    return ok({
      vaultAvailable: vaultAvailable(),
      providers: listProviders().map((p) => ({
        id: p.id,
        label: p.label,
        note: p.note,
        defaultModel: p.model,
        serverKeyPresent: p.configured,
      })),
      keys: await listUserKeys(),
    });
  } catch (e) {
    return handleError(e);
  }
}

const SaveBody = z
  .object({
    provider: z.enum(SUPPORTED_PROVIDERS),
    apiKey: z.string().min(8).max(400),
    label: z.string().max(60).nullish(),
    model: z.string().max(80).nullish(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if ('error' in auth) return auth.error;

    const rl = rateLimit(`keysave:${clientKey(req)}`, 20);
    if (!rl.allowed) return fail(429, 'Too many key updates. Please wait a minute.');

    const body = SaveBody.parse(await readJson(req, 3000));
    const result = await saveUserKey({
      provider: body.provider,
      apiKey: body.apiKey,
      label: body.label ?? null,
      model: body.model ?? null,
    });
    if (!result.ok) return fail(result.status, result.message);

    // Deliberately NOT "your key is valid" — nothing has called the provider
    // yet. The UI shows "Not checked" until /validate has actually run.
    return ok({
      key: result.view,
      message: 'Key saved and encrypted. Use "Test key" to confirm it works.',
    });
  } catch (e) {
    return handleError(e);
  }
}

const DeleteBody = z.object({ provider: z.enum(SUPPORTED_PROVIDERS) }).strict();

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if ('error' in auth) return auth.error;

    const body = DeleteBody.parse(await readJson(req, 500));
    const result = await deleteUserKey(body.provider);
    if (!result.ok) return fail(400, result.message ?? 'Could not remove that key.');
    return ok({ removed: body.provider });
  } catch (e) {
    return handleError(e);
  }
}
