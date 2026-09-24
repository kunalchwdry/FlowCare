import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/** Request-scoped client that carries the user's session => RLS applies. */
export async function getSupabaseServerClient() {
  const url = env.supabaseUrl();
  const key = env.supabaseAnonKey();
  if (!url || !key) return null;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
        try {
          list.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as never),
          );
        } catch {
          /* called from a Server Component: middleware refreshes the session */
        }
      },
    },
  });
}

/**
 * Service-role client. BYPASSES RLS — only used by explicitly authorised
 * admin/moderation and audit paths, never in response to unauthenticated
 * input. Never imported from a client component.
 */
export function getSupabaseAdminClient() {
  const url = env.supabaseUrl();
  const key = env.supabaseServiceKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
