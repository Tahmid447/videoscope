import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { Store } from '../../engine/store.ts';
export async function database(persist?: string) {
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'fixture',modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-01',d1Databases:['DB']}],...(persist?{resourcePersistencePath:persist}:{})}));
  const db=await mf.getD1Database('DB') as unknown as D1Database;
  const sql=readFileSync(new URL('../../cloudflare/migrations/0001_provider_engine.sql',import.meta.url),'utf8');
  if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scan_jobs'").first())
    await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  return {mf,db,store:new Store(db)};
}
export async function due(db:D1Database) {await db.batch([db.prepare('UPDATE scan_jobs SET next_run_at=0'),db.prepare('UPDATE provider_locks SET lease_until=0')]);}
