import { randomUUID } from 'node:crypto';
import { importRecord } from '../engine/import.ts';
import {htmlRecords} from '../engine/extractors.ts';
import { Store, hash } from '../engine/store.ts';
import { detect, providerById, providers } from '../engine/providers/index.ts';
import { runStep } from '../engine/runner.ts';
import { ProviderError } from '../engine/errors.ts';
import { activeStates, type Credentials, type ScanJob } from '../engine/model.ts';
export interface Env extends Credentials { DB: D1Database; ASSETS: Fetcher; SCAN_QUEUE?: Queue<{id:string}>; APP_VERSION?: string; BUILD_SHA?: string; }
const json = (body: unknown, status = 200) => Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
function publicJob(j: ScanJob) { const {owner:_owner,lease:_lease,...rest} = j; return {...rest,paused:j.status === 'paused',complete:j.status === 'complete',partial:j.status === 'partial' || j.partial,failed:j.status === 'failed'}; }
function ownerOf(req: Request) { const raw = req.headers.get('x-videoscope-workspace') || ''; if (!/^[a-zA-Z0-9_-]{24,100}$/.test(raw)) throw new ProviderError('workspace_required','A valid device workspace key is required.',401); return hash(raw); }
async function payload(req: Request, limit = 16_384) {
  if (Number(req.headers.get('content-length')) > limit) throw new ProviderError('request_limit','Request is too large.',413);
  const reader = req.body?.getReader(), chunks: Uint8Array[] = []; let n = 0;
  if (reader) for (;;) {const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit){await reader.cancel();throw new ProviderError('request_limit','Request is too large.',413);}chunks.push(value);}
  const data = new Uint8Array(n); let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try {return JSON.parse(new TextDecoder().decode(data) || '{}');}catch{throw new ProviderError('invalid_json','Invalid JSON request.',400);}
}
async function schedule(env: Env, id: string, delaySeconds = 1) {
  if (env.SCAN_QUEUE) try { await env.SCAN_QUEUE.send({id},{delaySeconds:Math.min(86400,Math.max(1,Math.ceil(delaySeconds)))}); } catch { console.log(JSON.stringify({event:'queue_delivery_deferred',scanId:id})); }
  // D1 owns the job. The scheduled sweep redelivers jobs if enqueue fails or
  // a message expires. HTTP requests never perform scan work.
}
export async function api(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url), parts = u.pathname.split('/').filter(Boolean).slice(1), store = new Store(env.DB);
  if (req.method === 'GET' && parts[0] === 'config') return json({version:env.APP_VERSION || '4.0.0',buildSha:env.BUILD_SHA || 'local',databaseMigration:'0001_provider_engine',backendOwnedScans:true,providers:providers.map(p=>p.capabilities(env))});
  const owner = ownerOf(req);
  if (!['GET','HEAD'].includes(req.method)) {
    const origin = req.headers.get('origin'); if (origin && origin !== u.origin) throw new ProviderError('origin_denied','Cross-origin mutations are not allowed.',403);
  }
  if (parts[0] === 'imports' && req.method === 'POST') {
    const b = await payload(req, 400_000);
    if(parts[1]==='parse') {
      const source=detect(String(b.url||''));
      if(typeof b.html!=='string')throw new ProviderError('invalid_import','A saved HTML page and its original public URL are required.',400);
      const parsed=htmlRecords(b.html,source.url);
      if(!parsed.items.length)throw new ProviderError('invalid_import','This saved HTML page contains no verified video records.',422);
      return json({items:parsed.items,label:parsed.title,input:source.url});
    }
    if (!parts[1]) {
      const source = detect(String(b.url || 'https://imported.example.com/'));
      const j = await store.create(owner,{...source,provider:'generic'},providerById('generic').capabilities(env),false,'import');
      j.status='paused';j.strategy='user import';j.warnings=['Imported file: coverage of the original source collection has not been verified.'];
      await env.DB.prepare('UPDATE scan_jobs SET status=?,state_json=? WHERE id=?').bind(j.status,JSON.stringify(j),j.id).run();
      return json(publicJob(j),201);
    }
    const saved = await store.job(parts[1],owner);
    if (!saved || saved.strategy!=='user import') throw new ProviderError('not_found','Import not found.',404);
    if (!Array.isArray(b.items) || b.items.length>24) throw new ProviderError('invalid_import','Upload at most 24 records per import batch.',400);
    const items=b.items.map((v:Record<string,unknown>)=>importRecord(v,owner)),lease=randomUUID();
    const claimed=await env.DB.prepare("UPDATE scan_jobs SET status='enumerating',lease=?,lease_until=? WHERE id=? AND owner=? AND status='paused' RETURNING id").bind(lease,Date.now()+120000,saved.id,owner).first();
    if(!claimed)throw new ProviderError('import_busy','This import is already being updated or has finished.',409);
    const j=(await store.job(saved.id,owner))!;
    j.status=b.final?'complete':'paused';j.finishedAt=b.final?new Date().toISOString():null;
    await store.commit(j,items,false,String(b.label||'Imported collection').slice(0,200));
    return json(publicJob((await store.job(j.id,owner))!));
  }
  if (parts[0] === 'detect' && req.method === 'POST') {const b = await payload(req), source = detect(String(b.url || '')); return json({...source,capabilities:providerById(source.provider).capabilities(env)});}
  if (parts[0] === 'collections' && !parts[1] && req.method === 'GET') {
    const r = await env.DB.prepare('SELECT c.*,j.status,json_extract(j.state_json,\'$.uniqueItemsCollected\') item_count FROM collections c JOIN scan_jobs j ON j.id=c.job_id WHERE c.owner=? ORDER BY c.updated_at DESC LIMIT 100').bind(owner).all(); return json(r.results);
  }
  if (parts[0] === 'collections' && parts[1]) {
    const c = await store.collection(parts[1],owner); if (!c) throw new ProviderError('not_found','Collection not found in this workspace.',404);
    if (req.method === 'GET' && !parts[2]) return json({...c,job:publicJob((await store.job(c.job_id,owner))!),metadataCoverage:await store.coverage(c.id)});
    if (req.method === 'GET' && parts[2] === 'videos') return json(await store.query(owner,c.id,u.searchParams));
    if (req.method === 'DELETE') {
      await store.control(c.job_id,owner,'cancel');
      await env.DB.prepare('DELETE FROM collections WHERE id=? AND owner=?').bind(c.id,owner).run();return json({ok:true});
    }
  }
  if (parts[0] === 'bookmarks') {
    if (req.method === 'GET') return json(await store.query(owner,null,u.searchParams,true));
    const b = await payload(req);
    if (req.method === 'POST') {const result=await env.DB.prepare('INSERT OR IGNORE INTO bookmarks(owner,video_id) SELECT ?,v.id FROM videos v WHERE v.id=? AND EXISTS(SELECT 1 FROM collection_videos cv JOIN collections c ON c.id=cv.collection_id WHERE c.owner=? AND cv.video_id=v.id)').bind(owner,String(b.id),owner).run();return json({ok:true,changed:result.meta.changes});}
    if (req.method === 'DELETE') {await env.DB.prepare('DELETE FROM bookmarks WHERE owner=? AND video_id=?').bind(owner,String(b.id)).run();return json({ok:true});}
  }
  if (parts[0] === 'scans' && !parts[1] && req.method === 'POST') {
    const b = await payload(req), source = detect(String(b.url || '')), mode = ['cached','refresh','full'].includes(b.mode) ? b.mode : 'cached';
    if (new URL(source.url).hostname === u.hostname) throw new ProviderError('self_scan','VideoScope cannot scan its own API.',400);
    const previous = await env.DB.prepare('SELECT c.job_id,c.updated_at,j.status FROM collections c JOIN scan_jobs j ON j.id=c.job_id WHERE c.owner=? AND c.input_url=? ORDER BY c.updated_at DESC LIMIT 1').bind(owner,source.url).first<{job_id:string;updated_at:string;status:string}>();
    const cap = providerById(source.provider).capabilities(env);
    if (previous && (activeStates.includes(previous.status) || mode === 'cached' && Date.now()-Date.parse(previous.updated_at) < cap.cacheTtlSeconds*1000 && ['complete','partial','paused'].includes(previous.status))) return json({...publicJob((await store.job(previous.job_id,owner))!),cached:true});
    const active = await env.DB.prepare("SELECT count(*) n FROM scan_jobs WHERE owner=? AND status IN ('queued','enumerating','enriching')").bind(owner).first<{n:number}>();
    if ((active?.n || 0) >= 2) throw new ProviderError('active_limit','Pause an active scan before starting another.',429);
    const key = `${owner}:${Math.floor(Date.now()/3600000)}`;
    const rate = await env.DB.prepare('INSERT INTO rate_buckets(bucket,requests,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 RETURNING requests').bind(key,Date.now()+3600000).first<{requests:number}>();
    if ((rate?.requests || 0) > 12) throw new ProviderError('scan_rate_limit','This workspace has reached its hourly new-scan budget. Existing scans can continue.',429);
    const j = await store.create(owner,source,cap,b.enrich !== false,mode);
    if (mode === 'refresh') j.warnings.push('Refresh re-enumerates the current public membership; unchanged metadata can use the response cache. A full rescan creates a separate snapshot.');
    if(!cap.configured){j.status='failed';j.failed=true;j.finishedAt=new Date().toISOString();j.errors=[{code:'credential_missing',message:`${cap.name} detected. Add ${cap.credential} to the backend environment; API authorization is not configured.`}];}
    await env.DB.prepare('UPDATE scan_jobs SET status=?,state_json=? WHERE id=?').bind(j.status,JSON.stringify(j),j.id).run();
    if(activeStates.includes(j.status))await schedule(env,j.id); return json(publicJob(j),201);
  }
  if (parts[0] === 'scans' && parts[1]) {
    const j = await store.job(parts[1],owner); if (!j) throw new ProviderError('not_found','Scan not found in this workspace.',404);
    if (req.method === 'GET') return json(publicJob(j));
    if (req.method === 'POST' && ['pause','resume','cancel'].includes(parts[2])) {const result=await store.control(j.id,owner,parts[2]);if(activeStates.includes(result.status))await schedule(env,j.id);return json(publicJob(result));}
  }
  throw new ProviderError('not_found','API route not found.',404);
}
export default {
  async fetch(req: Request, env: Env) {
    if (!new URL(req.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {return await api(req,env);} catch(e) {if(e instanceof ProviderError)return json({code:e.code,detail:e.message},e.status >= 400 && e.status <= 599 ? e.status : 400);console.error(JSON.stringify({event:'api_error',type:e instanceof Error ? e.name : 'unknown'}));return json({code:'service_error',detail:'The collection service could not complete the request. Saved progress is preserved.'},500);}
  },
  async queue(batch: MessageBatch<{id:string}>, env: Env) {
    const store=new Store(env.DB);
    for (const msg of batch.messages) {
      try {const j=await runStep(store,msg.body.id,env);if(j && !j.lease && activeStates.includes(j.status))await schedule(env,j.id,(j.nextRunAt-Date.now())/1000);msg.ack();}
      catch {msg.retry({delaySeconds:60});}
    }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    const store=new Store(env.DB), due=await env.DB.prepare("SELECT id FROM scan_jobs WHERE status IN ('queued','enumerating','enriching') AND next_run_at<=? AND lease_until<? ORDER BY next_run_at LIMIT 8").bind(Date.now()-(env.SCAN_QUEUE?60000:0),Date.now()).all<{id:string}>();
    for(const {id} of due.results) {if(env.SCAN_QUEUE)await schedule(env,id);else await runStep(store,id,env);}
    await env.DB.batch([env.DB.prepare('DELETE FROM response_cache WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM rate_buckets WHERE expires_at<?').bind(Date.now())]);
  },
};
