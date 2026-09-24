/**
 * FlowCare migration runner.
 *
 *   node scripts/db/migrate.mjs --dry     verify inside a rolled-back transaction
 *   node scripts/db/migrate.mjs           apply pending migrations for real
 *   node scripts/db/migrate.mjs --status  list applied vs pending
 *
 * Properties:
 *   - each migration runs in its own transaction; a failure rolls that file
 *     back entirely and stops the run
 *   - an advisory lock serialises concurrent runners
 *   - applied versions and their sha256 are recorded in fc_schema_migrations
 *   - a previously-applied file whose checksum changed is reported, not
 *     silently re-run
 *
 * The migrations themselves are additive and idempotent, so a re-run is safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { connect } from './client.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIR = path.join(ROOT, 'supabase/migrations');
const LOCK = 918273645;

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const statusOnly = args.has('--status');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const client = await connect();
let failed = false;
try {
  await client.query('select pg_advisory_lock($1)', [LOCK]);

  // The ledger is created by 0001, so it may not exist on a first run.
  const hasLedger = (await client.query("select to_regclass('public.fc_schema_migrations') t")).rows[0].t;
  const applied = new Map();
  if (hasLedger) {
    const r = await client.query('select version, checksum, applied_at from public.fc_schema_migrations');
    r.rows.forEach((row) => applied.set(row.version, row));
  }

  if (statusOnly) {
    for (const f of files) {
      const v = f.replace(/\.sql$/, '');
      const a = applied.get(v);
      const cs = sha(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const state = !a ? 'PENDING'
        : a.checksum && a.checksum !== cs ? `APPLIED (checksum drift: ${a.checksum} -> ${cs})`
        : `applied ${new Date(a.applied_at).toISOString().slice(0, 19)}Z`;
      console.log(`${v.padEnd(28)} ${state}`);
    }
    process.exit(0);
  }

  for (const f of files) {
    const version = f.replace(/\.sql$/, '');
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const checksum = sha(sql);
    const prev = applied.get(version);

    if (prev && !dry) {
      if (prev.checksum && prev.checksum !== checksum) {
        console.log(`DRIFT   ${version}  recorded=${prev.checksum} file=${checksum} (re-applying; migrations are idempotent)`);
      } else {
        console.log(`skip    ${version}  (already applied)`);
        continue;
      }
    }

    const t0 = Date.now();
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        `insert into public.fc_schema_migrations(version, checksum) values ($1,$2)
           on conflict (version) do update set checksum=excluded.checksum, applied_at=clock_timestamp()`,
        [version, checksum],
      );
      if (dry) {
        await client.query('rollback');
        console.log(`ok(dry) ${version}  ${Date.now() - t0}ms`);
      } else {
        await client.query('commit');
        console.log(`APPLIED ${version}  ${Date.now() - t0}ms  sha=${checksum}`);
      }
    } catch (e) {
      await client.query('rollback');
      console.error(`FAILED  ${version}\n  ${e.code} ${e.message}`);
      if (e.detail) console.error(`  detail: ${e.detail}`);
      if (e.hint) console.error(`  hint:   ${e.hint}`);
      failed = true;
      break;
    }
  }

  if (dry) console.log('\n-- dry run: every statement was rolled back --');
} finally {
  try { await client.query('select pg_advisory_unlock($1)', [LOCK]); } catch {}
  await client.end();
}
process.exit(failed ? 1 : 0);
