import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fail, handleError, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
}).strict();

export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await readJson(req, 1000));
    const supabase = await getSupabaseServerClient();
    if (!supabase) return fail(503, 'Password reset is unavailable right now.');

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return fail(401, 'This recovery link is invalid or has expired.');

    const { error } = await supabase.auth.updateUser({ password: body.password });
    if (error) return fail(400, error.message);

    return ok({ message: 'Password updated. You can now sign in.' });
  } catch (e) {
    return handleError(e);
  }
}
