import { getSupabaseServerClient } from '@/lib/supabase/server';
import { handleError, ok } from '@/lib/http';
import { isDemoMode } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who am I? Returns null rather than 401 so the nav can render either way. */
export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return ok({ user: null, authAvailable: false, demoMode: isDemoMode() });

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return ok({ user: null, authAvailable: true, demoMode: isDemoMode() });
    }
    return ok({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: (data.user.user_metadata?.full_name as string) ?? data.user.email,
        emailConfirmed: Boolean(data.user.email_confirmed_at),
      },
      authAvailable: true,
      demoMode: isDemoMode(),
    });
  } catch (e) {
    return handleError(e);
  }
}
