import test from 'node:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import { database,due } from './helpers.ts';
import { runStep } from '../../engine/runner.ts';
import { Store,hash } from '../../engine/store.ts';
import { record,type Provider } from '../../engine/model.ts';
import { ProviderError } from '../../engine/errors.ts';
import { api } from '../../cloudflare/worker.ts';
import type { Env } from '../../cloudflare/worker.ts';
const base:Provider={id:'fixture',detect:()=>null,capabilities:()=>({id:'fixture',name:'Fixture',sourceTypes:['collection'],metrics:['views'],enumeration:true,credential:null,configured:true,download:false,note:'Synthetic test only',delayMs:0,cacheTtlSeconds:60,enrichmentBatch:10}),enumerate:async()=>({items:[],nextCursor:null,complete:true,empty:true})};
async function start(store:Store,p:Provider=base){return store.create('owner',{provider:p.id,url:'https://fixture.example.com/collection',sourceType:'collection'},p.capabilities({}),false,'full');}
const video=(i:number)=>record('fixture',String(i).padStart(5,'0'),`https://fixture.example.com/video/${i}`,{title:`Lesson ${i}`,uploader:i%2?'Other Teacher':'Physics Lab',description:'Public education',views:i===0?null:i===1?0:i,likes:i,comments:i*2,durationSeconds:i*60,publishedAt:`2026-01-${String(i%28+1).padStart(2,'0')}T00:00:00Z`,tags:['education']});
test('1,146 records persist across 58 pages; reopening Store, pause/resume, dedupe, all-page SQL filters',async()=>{
  const {mf,db,store}=await database();try{
    const p:Provider={...base,enumerate:async(_s,cursor)=>{const n=Number(cursor||0);const items=Array.from({length:Math.min(20,1146-n*20)},(_,i)=>video(n*20+i));return {items:n?[video(0),...items]:items,nextCursor:n<57?n+1:null,complete:n===57,expectedCount:1146};}};
    let j=await start(store,p);
    for(let n=0;n<3;n++){await due(db);j=(await runStep(store,j.id,{}, {provider:p}))!;}
    assert.equal(j.uniqueItemsCollected,60);assert.equal(j.nextCursor,3);
    await store.control(j.id,'owner','pause');assert.equal((await runStep(store,j.id,{}, {provider:p}))!.status,'paused');
    const reopened=new Store(db);assert.equal((await reopened.job(j.id))!.uniqueItemsCollected,60);
    await reopened.control(j.id,'owner','resume');
    for(let n=0;n<60&&!['complete','partial','failed'].includes(j.status);n++){await due(db);j=(await runStep(reopened,j.id,{}, {provider:p}))!;}
    assert.equal(j.status,'complete');assert.equal(j.uniqueItemsCollected,1146);assert.equal(j.pagesRead,58);
    const query=(s:string)=>store.query('owner',j.collectionId,new URLSearchParams(s));
    const desc=await query('sort=views_desc');assert.equal(desc.items[0].views,1145);assert.equal(desc.items.length,24);
    const asc=await query('sort=views_asc');assert.equal(asc.items[0].views,0);assert.equal(asc.total,1146);
    const last=await query('sort=views_asc&page=48');assert.equal(last.items.at(-1).views,null);
    const p2=await query('sort=views_desc&page=2');assert.ok(desc.items.at(-1).views>p2.items[0].views);
    assert.equal((await query('minViews=0')).total,1145);assert.equal((await query('minViews=10&maxViews=20')).total,11);
    assert.equal((await query('minDuration=600&maxDuration=1200')).total,11);
    assert.ok((await query('q=physics')).items.every((x:any)=>x.uploader==='Physics Lab'));
    assert.equal((await query('q=Lesson%201145')).total,1);
    assert.ok((await query('from=2026-01-02&to=2026-01-03')).items.every((x:any)=>x.publishedAt>='2026-01-02'&&x.publishedAt<'2026-01-04'));
    assert.equal((await query('sort=published_desc')).items[0].publishedAt,'2026-01-28T00:00:00.000Z');assert.equal((await query('sort=published_asc')).items[0].publishedAt,'2026-01-01T00:00:00.000Z');
    await assert.rejects(store.query('another-owner',j.collectionId,new URLSearchParams()),/not found/);
  }finally{await mf.dispose();}
});
test('atomic lease fencing prevents a paused in-flight page from mutating records or cursor',async()=>{
  const {mf,db,store}=await database();try{
    let release:(v:void)=>void=()=>{};const gate=new Promise<void>(r=>release=r);
    const p:Provider={...base,enumerate:async()=>{await gate;return {items:[video(1)],nextCursor:1,complete:false};}};
    const j=await start(store,p);const running=runStep(store,j.id,{}, {provider:p});
    for(let n=0;n<100;n++){if((await store.job(j.id))?.lease)break;await new Promise(r=>setTimeout(r,10));}
    await store.control(j.id,'owner','pause');release();await running;
    const saved=(await store.job(j.id))!;assert.equal(saved.status,'paused');assert.equal(saved.uniqueItemsCollected,0);
    assert.equal((await store.query('owner',j.collectionId,new URLSearchParams())).total,0);
    const checkpoints=await db.prepare('SELECT count(*) n FROM scan_checkpoints').first<{n:number}>();assert.equal(checkpoints?.n,0);
  }finally{await mf.dispose();}
});
test('retry keeps cursor and records, respects backoff, and final shortfall is partial',async()=>{
  const {mf,db,store}=await database();try{
    let calls=0;
    const p:Provider={...base,enumerate:async(_s,c)=>{calls++;if(calls===2)throw new ProviderError('http_429','rate limited',429,true,30_000);return {items:[video(c?2:1)],nextCursor:c?null:1,complete:!!c,expectedCount:3};}};
    const initial=await start(store,p);await runStep(store,initial.id,{}, {provider:p});await due(db);
    const retry=(await runStep(store,initial.id,{}, {provider:p}))!;assert.equal(retry.nextCursor,1);assert.equal(retry.uniqueItemsCollected,1);assert.ok(retry.nextRunAt>=Date.now()+29_000);
    await due(db);await runStep(store,initial.id,{}, {provider:p});await due(db);const done=(await runStep(store,initial.id,{}, {provider:p}))!;
    assert.equal(done.status,'partial');assert.equal(done.uniqueItemsCollected,2);
  }finally{await mf.dispose();}
});
test('empty intermediate page with explicit cursor continues; cursor cycle is partial, not complete',async()=>{
  const {mf,db,store}=await database();try{
    const p:Provider={...base,enumerate:async(_s,c)=>({items:c===1?[]:[video(1)],nextCursor:c===null?1:2,complete:false})};
    const j=await start(store,p);for(let n=0;n<5;n++){await due(db);await runStep(store,j.id,{}, {provider:p});}
    assert.equal((await store.job(j.id))!.status,'partial');assert.equal((await store.job(j.id))!.uniqueItemsCollected,1);
  }finally{await mf.dispose();}
});
test('empty collection differs from parser failure and a missing YouTube credential is visible via API',async()=>{
  const {mf,db,store}=await database();try{
    const j=await start(store);await runStep(store,j.id,{}, {provider:base});await due(db);assert.equal((await runStep(store,j.id,{}, {provider:base}))!.status,'complete');
    const env={DB:db} as Env,headers={'x-videoscope-workspace':'workspace_fixture_01234567890123456789','content-type':'application/json'};
    const response=await api(new Request('https://app.example.com/api/scans',{method:'POST',headers,body:JSON.stringify({url:'https://www.youtube.com/@FilmiIndian/videos'})}),env);
    assert.equal(response.status,201);const created=await response.json() as any;await due(db);const failed=(await runStep(store,created.id,{}))!;assert.equal(failed.status,'failed');assert.match(failed.errors[0].message,/YOUTUBE_API_KEY/);
  }finally{await mf.dispose();}
});

test('a new Worker runtime resumes a persisted cursor after shutdown and duplicate delivery is fenced',async()=>{
 await mkdir('artifacts',{recursive:true});const dir=await mkdtemp('artifacts/restart-');let runtime=await database(dir);
 const p:Provider={...base,enumerate:async(_s,c)=>({items:[video(c?2:1)],nextCursor:c?null:1,complete:!!c,expectedCount:2})};
 try{
  const j=await start(runtime.store,p);await runStep(runtime.store,j.id,{}, {provider:p});await runtime.mf.dispose();
  runtime=await database(dir);const saved=(await runtime.store.job(j.id))!;assert.equal(saved.nextCursor,1);assert.equal(saved.uniqueItemsCollected,1);
  await due(runtime.db);await Promise.all([runStep(runtime.store,j.id,{}, {provider:p}),runStep(runtime.store,j.id,{}, {provider:p})]);await due(runtime.db);const done=(await runStep(runtime.store,j.id,{}, {provider:p}))!;
  assert.equal(done.status,'complete');assert.equal(done.pagesRead,2);assert.equal(done.uniqueItemsCollected,2);
 }finally{await runtime.mf.dispose();await rm(dir,{recursive:true,force:true});}
});
test('partial enumeration still enriches saved records and resumes at the failed source cursor',async()=>{
 const {mf,db,store}=await database();let available=false;
 const p:Provider={...base,enrich:async(items,ctx)=>items.map(v=>({...v,thumbnailUrl:'https://images.example.com/video.jpg',enrichedAt:ctx.now})),enumerate:async(_s,c)=>{if(c&&!available)throw new ProviderError('http_403','Source denied this page',403);return {items:[video(c?2:1)],nextCursor:c?null:1,complete:!!c,expectedCount:2};}};
 try{
  const initial=await store.create('owner',{provider:p.id,url:'https://fixture.example.com/collection',sourceType:'collection'},p.capabilities({}),true,'full');let j=initial;
  for(let i=0;i<5;i++){await due(db);j=(await runStep(store,j.id,{}, {provider:p}))!;}
  assert.equal(j.status,'partial');assert.equal(j.nextCursor,1);assert.equal((await store.coverage(j.collectionId)).thumbnailUrl,1);
  available=true;await store.control(j.id,'owner','resume');
  for(let i=0;i<4;i++){await due(db);j=(await runStep(store,j.id,{}, {provider:p}))!;}
  assert.equal(j.status,'complete');assert.equal(j.uniqueItemsCollected,2);assert.equal((await store.coverage(j.collectionId)).thumbnailUrl,2);
 }finally{await mf.dispose();}
});
test('imports are isolated, bookmarked state works beyond 96 saved videos, and cancel survives queue delivery',async()=>{
 const {mf,db,store}=await database();const key='workspace_fixture_import_0123456789012345',owner=hash(key),env={DB:db}as Env;
 const call=async(path:string,body?:any,method?:string)=>{const r=await api(new Request('https://app.example.com/api/'+path,{method:method||(body?'POST':'GET'),headers:{'x-videoscope-workspace':key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);return r.json()as Promise<any>;};
 try{
  const parsed=await call('imports/parse',{url:'https://fixture.example.com/video/1',html:'<meta property="og:type" content="video.other"><meta property="og:title" content="Imported lesson">'});assert.equal(parsed.items[0].title,'Imported lesson');
  const j=await call('imports',{url:'https://fixture.example.com/collection'});
  for(let i=0;i<5;i++)await call('imports/'+j.id,{items:Array.from({length:24},(_,n)=>video(i*24+n)),final:i===4});
  const all=await store.query(owner,j.collectionId,new URLSearchParams('pageSize=96'));
  assert.equal(all.total,120);assert.ok(all.items.every((v:any)=>v.provider==='import'));
  const ids=(await db.prepare('SELECT video_id FROM collection_videos WHERE collection_id=?').bind(j.collectionId).all<{video_id:string}>()).results;
  await db.prepare("INSERT INTO bookmarks(owner,video_id) SELECT ?,video_id FROM collection_videos WHERE collection_id=?").bind(owner,j.collectionId).run();
  const last=await store.query(owner,j.collectionId,new URLSearchParams('pageSize=96&page=2'));assert.equal(last.items.length,24);assert.ok(last.items.every((v:any)=>v.bookmarked));
  await call('bookmarks',{id:ids[0].video_id},'DELETE');assert.equal((await call('bookmarks')).total,119);
  await assert.rejects(store.query('another-owner',j.collectionId,new URLSearchParams()),/not found/);
  let active=await start(store);active=await store.control(active.id,'owner','cancel');assert.equal((await runStep(store,active.id,{}, {provider:base}))!.status,'cancelled');
 }finally{await mf.dispose();}
});
test('fifty-record commits remain within the free D1 query and bound-parameter budgets',async()=>{
 const {mf,db}=await database();let count=0,maxBindings=0;
 function statement(s:D1PreparedStatement):D1PreparedStatement{return new Proxy(s,{get(target,key){if(key==='bind')return(...args:any[])=>{maxBindings=Math.max(maxBindings,args.length);return statement(target.bind(...args));};if(['run','all','first','raw'].includes(String(key)))return(...args:any[])=>{count++;return (target as any)[key](...args);};const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}});}
 const metered=new Proxy(db,{get(target,key){if(key==='prepare')return(sql:string)=>statement(target.prepare(sql));if(key==='batch')return(statements:D1PreparedStatement[])=>{count+=statements.length;return target.batch(statements);};const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}});
 try{
  const store=new Store(metered);const p:Provider={...base,enumerate:async()=>({items:Array.from({length:50},(_,i)=>video(i)),nextCursor:null,complete:true})};const j=await start(store,p);count=0;
  await runStep(store,j.id,{}, {provider:p});assert.ok(count<40,`Used ${count} queries`);assert.ok(maxBindings<=100);assert.equal((await store.job(j.id))!.uniqueItemsCollected,50);
 }finally{await mf.dispose();}
});

test('repeated Worker termination becomes an explicit failure instead of an endless queue loop',async()=>{
 const {mf,db,store}=await database();try{
  const initial=await start(store);await store.claim(initial.id);
  for(let i=0;i<4;i++){await db.prepare('UPDATE scan_jobs SET lease_until=0 WHERE id=?').bind(initial.id).run();await store.claim(initial.id);}
  const j=(await store.job(initial.id))!;assert.equal(j.status,'failed');assert.equal(j.errors[0].code,'worker_interrupted');assert.equal(j.pagesRead,0);assert.equal(j.nextCursor,null);
 }finally{await mf.dispose();}
});

test('provider timestamps in different time zones share UTC SQL ordering and date boundaries',async()=>{
 const {mf,db,store}=await database();try{
  const dates=['2026-01-02T01:00:00+09:00','2026-01-01T23:00:00-05:00','not a date'];
  const p:Provider={...base,enumerate:async()=>({items:dates.map((publishedAt,i)=>record('fixture',String(i),`https://fixture.example.com/video/${i}`,{title:String(i),publishedAt})),nextCursor:null,complete:true})};
  const j=await start(store,p);await runStep(store,j.id,{}, {provider:p});await due(db);await runStep(store,j.id,{}, {provider:p});
  const ordered=await store.query('owner',j.collectionId,new URLSearchParams('sort=published_asc'));
  assert.deepEqual(ordered.items.map((v:any)=>v.publishedAt),['2026-01-01T16:00:00.000Z','2026-01-02T04:00:00.000Z',null]);
  const day=await store.query('owner',j.collectionId,new URLSearchParams('from=2026-01-02&to=2026-01-02'));
  assert.equal(day.total,1);assert.equal(day.items[0].id,'fixture:1');
 }finally{await mf.dispose();}
});
