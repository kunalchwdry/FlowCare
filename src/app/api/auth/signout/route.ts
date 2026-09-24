import { getSupabaseServerClient } from '@/lib/supabase/server';
import { handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const supabase = await getSupabaseServerClient();
    await supabase?.auth.signOut();
    return ok({ signedOut: true });
  } catch (e) {
    return handleError(e);
  }
}
