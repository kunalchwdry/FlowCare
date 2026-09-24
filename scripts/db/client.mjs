/**
 * Shared Postgres connection for FlowCare's migration + seed scripts.
 *
 * Reads credentials from .env.local ONLY (gitignored, chmod 600). Nothing in
 * this file, or anything it prints, may contain a secret.
 *
 * Why the pooler and not db.<ref>.supabase.co:
 *   Supabase's direct database host is IPv6-only. Environments without IPv6
 *   egress (CI containers, this sandbox) cannot reach it at all. The Supavisor
 *   session pooler is dual-stack, so it is the portable choice. Session mode
 *   (5432), not transaction mode (6543), because migrations need advisory
 *   locks and multi-statement transactions.
 */
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

function readEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) {
    throw new Error('.env.local not found. Copy .env.example and fill it in.');
  }
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function config() {
  const e = readEnvLocal();
  const ref = e.SUPABASE_PROJECT_REF;
  const password = e.SUPABASE_DB_PASSWORD;
  if (!ref || !password) {
    throw new Error('SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set in .env.local');
  }
  return {
    ref,
    url: e.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    host: e.SUPABASE_DB_HOST || `aws-0-${e.SUPABASE_DB_REGION || 'ap-northeast-1'}.pooler.supabase.com`,
    port: Number(e.SUPABASE_DB_PORT || 5432),
    user: `postgres.${ref}`,
    password,
  };
}

export async function connect() {
  const c = config();
  const client = new Client({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    application_name: 'flowcare-migrate',
  });
  await client.connect();
  return client;
}
