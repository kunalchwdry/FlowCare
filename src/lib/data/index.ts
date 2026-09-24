import { isDemoMode, liveReadMode } from '@/lib/env';
import { demoRepo } from './demoRepo';
import { liveRepo } from './liveRepo';
import { createSupabaseRepo } from './supabaseRepo';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import type { Repo } from './repo';

/**
 * Chooses the active repository for this request.
 * Supabase when configured, otherwise the clearly-labelled demo dataset.
 */
export async function getRepo(): Promise<Repo> {
  // Live facility reads with a local booking layer. Checked before demo mode
  // because it is a deliberate override, not a fallback.
  if (liveReadMode()) return liveRepo;
  if (isDemoMode()) return demoRepo;
  const client = await getSupabaseServerClient();
  if (!client) return demoRepo;
  return createSupabaseRepo(client, getSupabaseAdminClient());
}

export type { Repo } from './repo';
