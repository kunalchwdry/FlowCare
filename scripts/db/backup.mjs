/** Snapshot the current public schema + all rows to a timestamped JSON file. */
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './client.mjs';
const ROOT = path.resolve(import.meta.dirname, '../..');
const c = await connect();
const tables = (await c.query(
  "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
)).rows.map(r => r.table_name);
const dump = { takenAt: new Date().toISOString(), tables: {}, ddl: {} };
for (const t of tables) {
  dump.tables[t] = (await c.query(`select * from public.${JSON.stringify(t).replace(/"/g,'"')}`)).rows;
}
dump.ddl.columns = (await c.query(
  "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by 1,ordinal_position")).rows;
dump.ddl.constraints = (await c.query(
  "select conrelid::regclass::text tbl, conname, pg_get_constraintdef(oid) def from pg_constraint where connamespace='public'::regnamespace order by 1,2")).rows;
dump.ddl.policies = (await c.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows;
dump.ddl.functions = (await c.query(
  "select n.nspname, p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2")).rows;
await c.end();
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const out = path.join(ROOT, `backups/pre-migration-${stamp}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(dump, null, 1));
const rows = Object.entries(dump.tables).map(([k,v])=>`${k}=${v.length}`).join(' ');
console.log('backup ->', path.relative(ROOT,out));
console.log('rows:', rows);
console.log('functions captured:', dump.ddl.functions.length, '| policies:', dump.ddl.policies.length);
