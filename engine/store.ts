import { createHash, randomUUID } from 'node:crypto';
import { filterSql } from './filter.ts';
import { activeStates, type ScanJob, type VideoRecord, type Json, type Detection, type Capabilities, type State } from './model.ts';
import { ProviderError } from './errors.ts';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function cursorKey(cursor: Json): string {
  if (typeof cursor === 'string') return hash(cursor);
  if (cursor && !Array.isArray(cursor) && typeof cursor === 'object' && typeof cursor.checkpointKey === 'string') return hash(cursor.checkpointKey);
  if (cursor && !Array.isArray(cursor) && typeof cursor === 'object' && typeof cursor.url === 'string') return hash(cursor.url);
  return hash(JSON.stringify(cursor));
}
interface JobRow {state_json: string; status: State; phase: ScanJob['phase']; revision: number; lease: string | null; lease_until: number; next_run_at: number;}
export class Store {
  constructor(public db: D1Database) {}
  async job(id: string, owner?: string): Promise<ScanJob | null> {
    const row = await this.db.prepare(`SELECT * FROM scan_jobs WHERE id = ?${owner ? ' AND owner = ?' : ''}`).bind(...(owner ? [id, owner] : [id])).first<JobRow>();
    return row ? {...JSON.parse(row.state_json), status: row.status, phase: row.phase, revision: row.revision, lease: row.lease, leaseUntil: row.lease_until, nextRunAt: row.next_run_at} : null;
  }
  async create(owner: string, source: Detection, cap: Capabilities, enrichment: boolean, mode: string): Promise<ScanJob> {
    const now = new Date().toISOString(), cid = randomUUID(), id = randomUUID();
    const j: ScanJob = {id, collectionId: cid, owner, inputUrl: source.url, provider: source.provider, sourceType: source.sourceType, scanMode:mode, status: 'queued', phase: 'enumerating', currentCursor: null, nextCursor: null, expectedCount: null, uniqueItemsCollected: 0, pagesRead: 0, requestsMade: 0, revision: 0, lease: null, leaseUntil: 0, nextRunAt: 0, retries: 0, enrichedCount: 0, enrichedAfter: '', enrichment, partial: false, complete: false, failed: false, paused: false, startedAt: now, updatedAt: now, finishedAt: null, warnings: [], errors: [], diagnostics: [], metadataCoverage: {}, providerCapabilities: cap, strategy: 'provider enumeration'};
    await this.db.batch([
      this.db.prepare('INSERT INTO collections(id,owner,input_url,provider,source_type,label,created_at,updated_at,job_id,refresh_mode) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(cid,owner,source.url,source.provider,source.sourceType,new URL(source.url).hostname,now,now,id,mode),
      this.db.prepare('INSERT INTO scan_jobs(id,collection_id,owner,provider,status,phase,state_json) VALUES(?,?,?,?,?,?,?)').bind(id,cid,owner,source.provider,j.status,j.phase,JSON.stringify(j)),
      this.db.prepare('INSERT INTO providers(id,capabilities_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET capabilities_json=excluded.capabilities_json').bind(cap.id, JSON.stringify(cap)),
    ]);
    return j;
  }
  async claim(id: string): Promise<ScanJob | null> {
    const token = randomUUID(), now = Date.now();
    const row = await this.db.prepare("UPDATE scan_jobs SET state_json=CASE WHEN lease IS NOT NULL THEN json_set(state_json,'$.recoveryAttempts',COALESCE(json_extract(state_json,'$.recoveryAttempts'),0)+1) ELSE state_json END,lease=?,lease_until=? WHERE id=? AND status IN ('queued','enumerating','enriching') AND lease_until < ? AND next_run_at <= ? RETURNING id").bind(token,now+120_000,id,now,now).first();
    const j=row?await this.job(id):null;
    if(j && (j.recoveryAttempts||0)>=4){j.status=j.uniqueItemsCollected?'partial':'failed';j.finishedAt=new Date().toISOString();j.errors.push({code:'worker_interrupted',message:'This scan step repeatedly lost its Worker before saving. Progress is retained; check Worker resource limits before continuing.'});await this.commit(j,[],false);return null;}
    return j;
  }
  async claimProvider(j: ScanJob): Promise<boolean> {
    const key = `${j.provider}:${new URL(j.inputUrl).hostname}`;
    const result = await this.db.prepare('INSERT INTO provider_locks(id,lease,lease_until) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease, lease_until=excluded.lease_until WHERE provider_locks.lease_until < ? RETURNING id').bind(key,j.lease,Date.now()+120_000,Date.now()).first();
    return !!result;
  }
  async releaseProvider(j: ScanJob) { await this.db.prepare('UPDATE provider_locks SET lease_until=? WHERE lease=?').bind(Date.now()+j.providerCapabilities.delayMs,j.lease).run(); }
  async releaseJob(j: ScanJob, delay = 1000) { await this.db.prepare('UPDATE scan_jobs SET lease=NULL,lease_until=0,next_run_at=? WHERE id=? AND lease=?').bind(Date.now()+delay,j.id,j.lease).run(); }
  async seen(j: ScanJob, cursor: Json) { return !!await this.db.prepare('SELECT 1 FROM scan_checkpoints WHERE scan_id=? AND cursor_key=?').bind(j.id,cursorKey(cursor)).first(); }
  async repeated(j: ScanJob, fingerprint: string) { return !!await this.db.prepare('SELECT 1 FROM scan_checkpoints WHERE scan_id=? AND fingerprint=?').bind(j.id,fingerprint).first(); }
  async commit(j: ScanJob, incoming: VideoRecord[], checkpoint: boolean, label?: string): Promise<boolean> {
    const items = [...new Map(incoming.map(v => [v.id,v])).values()], oldLease = j.lease, revision = j.revision;
    const count = await this.db.prepare('SELECT count(*) n FROM collection_videos WHERE collection_id=?').bind(j.collectionId).first<{n:number}>();
    let existing = 0;
    const memberIds=new Set<string>();
    const previous = new Map<string,VideoRecord>();
    for (let offset=0;offset<items.length;offset+=80) {
      const chunk=items.slice(offset,offset+80), placeholders=chunk.map(()=>'?').join(',');
      const [membership, records] = await this.db.batch([
        this.db.prepare(`SELECT video_id FROM collection_videos WHERE collection_id=? AND video_id IN (${placeholders})`).bind(j.collectionId,...chunk.map(x=>x.id)),
        this.db.prepare(`SELECT id,record_json FROM videos WHERE id IN (${placeholders})`).bind(...chunk.map(x=>x.id)),
      ]);
      existing += membership.results.length;
      for(const row of membership.results as any[])memberIds.add(row.video_id);
      for(const row of records.results as any[]) previous.set(row.id,JSON.parse(row.record_json));
    }
    for(let i=0;i<items.length;i++) {
      const current=items[i], old=previous.get(current.id);
      if(!current.enrichedAt && old) {
        const known=Object.fromEntries(Object.entries(current).filter(([,v])=>v!==null && v!=='' && !(Array.isArray(v)&&!v.length)));
        const fresh=j.scanMode!=='full' && old.enrichedAt && Date.now()-Date.parse(old.enrichedAt)<j.providerCapabilities.cacheTtlSeconds*1000;
        items[i]={...old,...known,metadataSources:{...old.metadataSources,...current.metadataSources},enrichedAt:fresh?old.enrichedAt:null};
      }
    }
    j.uniqueItemsCollected = (count?.n || 0) + items.length - existing;
    j.updatedAt = new Date().toISOString(); j.revision++; j.leaseUntil = 0;j.recoveryAttempts=0;
    j.complete = j.status === 'complete'; j.failed = j.status === 'failed'; j.paused = j.status === 'paused';
    const guard = "EXISTS(SELECT 1 FROM scan_jobs WHERE id=? AND lease=? AND revision=? AND status IN ('queued','enumerating','enriching'))";
    const tokens = [j.id,oldLease,revision];
    const statements: D1PreparedStatement[] = [];
    const writes = items.filter(v => !(memberIds.has(v.id) && !v.enrichedAt && j.phase === 'enumerating'));
    if (writes.length) {
      const rows = writes.map(v => ({id:v.id,provider:v.provider,source_video_id:v.sourceVideoId,canonical_url:v.canonicalUrl,title:v.title,description:v.description,uploader:v.uploader,
        uploader_search:v.uploader?.toLocaleLowerCase() ?? null,published_at:v.publishedAt,views:v.views,likes:v.likes,comments:v.comments,rating:v.rating,rating_scale:v.ratingScale,
        duration_seconds:v.durationSeconds,height:v.height,is_hd:v.isHD===null?null:Number(v.isHD),thumbnail_url:v.thumbnailUrl,
        search_text:[v.title,v.description,v.uploader,...v.tags,...v.categories].filter(Boolean).join(' ').toLocaleLowerCase(),record_json:JSON.stringify(v),fetched_at:v.fetchedAt,enriched_at:v.enrichedAt}));
      const cols = Object.keys(rows[0]).filter(c=>c!=='enriched_at');
      // JSON table input keeps a 50-item API page below D1's 100 bind and
      // 50-query free-tier limits without weakening the atomic lease fence.
      const batchJson=JSON.stringify(rows);
      statements.push(this.db.prepare(`INSERT INTO videos(${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE ${guard} ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(c=>`${c}=excluded.${c}`).join(',')} WHERE ${guard}`).bind(batchJson,...tokens,...tokens));
      statements.push(this.db.prepare(`INSERT INTO collection_videos(collection_id,video_id,enriched_at) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.enriched_at') FROM json_each(?) WHERE ${guard} ON CONFLICT(collection_id,video_id) DO UPDATE SET enriched_at=COALESCE(excluded.enriched_at,collection_videos.enriched_at) WHERE ${guard}`).bind(j.collectionId,batchJson,...tokens,...tokens));
    }
    if (checkpoint) statements.push(this.db.prepare(`INSERT OR IGNORE INTO scan_checkpoints(scan_id,cursor_key,revision,fingerprint,saved_at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(j.id,cursorKey(j.currentCursor),revision,items.length ? hash(items.map(x=>x.id).sort().join('|')) : null,j.updatedAt,...tokens));
    statements.push(this.db.prepare(`UPDATE collections SET updated_at=?,label=COALESCE(?,label) WHERE id=? AND ${guard}`).bind(j.updatedAt,label || null,j.collectionId,...tokens));
    statements.push(this.db.prepare(`UPDATE scan_jobs SET status=?,phase=?,revision=?,lease=NULL,lease_until=0,next_run_at=?,state_json=? WHERE id=? AND lease=? AND revision=? AND status IN ('queued','enumerating','enriching')`).bind(j.status,j.phase,j.revision,j.nextRunAt,JSON.stringify({...j,lease:null}),j.id,oldLease,revision));
    const results = await this.db.batch(statements);
    return results.at(-1)!.meta.changes > 0;
  }
  async control(id: string, owner: string, action: string) {
    const j = await this.job(id,owner); if (!j) throw new ProviderError('not_found','Scan not found in this workspace.',404);
    if (action === 'pause' && activeStates.includes(j.status)) j.status = 'paused';
    else if (action === 'cancel' && j.status !== 'complete') j.status = 'cancelled';
    else if (action === 'resume' && ['paused','partial','failed'].includes(j.status)) {
      if(j.enumerationInterrupted && j.status!=='paused'){j.phase='enumerating';j.enumerationInterrupted=false;}
      if(j.status!=='paused') j.errors = [];
      j.status = j.phase; j.retries = 0; j.finishedAt = null;
    }
    else return j;
    j.revision++; j.updatedAt = new Date().toISOString(); j.nextRunAt = 0; j.lease = null; j.leaseUntil = 0;
    await this.db.prepare('UPDATE scan_jobs SET status=?,phase=?,revision=?,lease=NULL,lease_until=0,next_run_at=0,state_json=? WHERE id=? AND owner=?').bind(j.status,j.phase,j.revision,JSON.stringify(j),id,owner).run();
    return j;
  }
  async enrichBatch(j: ScanJob, limit: number) {
    const r = await this.db.prepare('SELECT v.record_json FROM videos v JOIN collection_videos cv ON cv.video_id=v.id WHERE cv.collection_id=? AND cv.enriched_at IS NULL AND v.id > ? ORDER BY v.id LIMIT ?').bind(j.collectionId,j.enrichedAfter,limit).all<{record_json:string}>();
    return r.results.map(x=>JSON.parse(x.record_json) as VideoRecord);
  }
  async coverage(cid: string) {
    const keys: Record<string,string> = {title:'title',thumbnailUrl:'thumbnail_url',views:'views',likes:'likes',comments:'comments',rating:'rating',publishedAt:'published_at',durationSeconds:'duration_seconds'};
    const r = await this.db.prepare(`SELECT ${Object.entries(keys).map(([k,c]) => `count(v.${c}) AS ${k}`).join(',')},sum(v.views) totalViews FROM videos v JOIN collection_videos cv ON cv.video_id=v.id WHERE cv.collection_id=?`).bind(cid).first<Record<string,number>>();
    return r || {};
  }
  async collection(id: string, owner: string) { return this.db.prepare('SELECT * FROM collections WHERE id=? AND owner=?').bind(id,owner).first<any>(); }
  async query(owner: string, cid: string | null, params: URLSearchParams, saved = false) {
    if (cid && !await this.collection(cid,owner)) throw new ProviderError('not_found','Collection not found.',404);
    const f = filterSql(params), join = saved ? 'JOIN bookmarks cv ON cv.video_id=v.id' : 'JOIN collection_videos cv ON cv.video_id=v.id JOIN collections c ON c.id=cv.collection_id';
    const base = saved ? 'cv.owner=?' : cid ? 'c.owner=? AND cv.collection_id=?' : 'c.owner=?';
    const bind: (string|number)[] = cid && !saved ? [owner,cid] : [owner];
    const sql = `FROM videos v ${join} WHERE ${base}${f.where}`;
    const [count, rows] = await this.db.batch([
      this.db.prepare(`SELECT count(DISTINCT v.id) n ${sql}`).bind(...bind,...f.values),
      this.db.prepare(`SELECT DISTINCT v.id,v.record_json,EXISTS(SELECT 1 FROM bookmarks b WHERE b.owner=? AND b.video_id=v.id) bookmarked ${sql} ORDER BY ${f.order} LIMIT ? OFFSET ?`).bind(owner,...bind,...f.values,f.pageSize,f.offset),
    ]);
    return {total: (count.results[0] as any).n, items: rows.results.map((r:any)=>({...JSON.parse(r.record_json),bookmarked:!!r.bookmarked})), page:f.page,pageSize:f.pageSize};
  }
}
