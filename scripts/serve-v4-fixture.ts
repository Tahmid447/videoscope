// Test-only local HTTP server. Never bundled or deployed.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {database,due} from '../tests/v4/helpers.ts';
import {api,type Env} from '../cloudflare/worker.ts';
import {generic} from '../engine/providers/generic.ts';
import {runStep} from '../engine/runner.ts';
import {record,type Provider} from '../engine/model.ts';
const {db,store,mf}=await database();
const fixture:Provider={...generic,enrich:async(items,ctx)=>items.map(v=>({...v,enrichedAt:ctx.now})),capabilities:env=>({...generic.capabilities(env),delayMs:0,enrichmentBatch:20}),enumerate:async(_s,c)=>{
 const page=Number(c||0),items=Array.from({length:20},(_,i)=>{const n=page*20+i;return record('generic','fixture'+String(n).padStart(3,'0'),`https://example.com/video/${n}`,{title:`Synthetic lesson ${n}`,uploader:n%2?'Teaching Lab':'Physics Lab',views:n===0?null:n===1?0:n===59?2_689_653_688:n*100,likes:n,comments:n*2,durationSeconds:n*60,publishedAt:`2026-01-${String(n%28+1).padStart(2,'0')}T00:00:00Z`,description:'Explicitly synthetic browser fixture',tags:['learning'],thumbnailUrl:null});});
 return {items,nextCursor:page<2?page+1:null,complete:page===2,expectedCount:60,label:'Synthetic browser collection'};
}};
const server=createServer(async(req,res)=>{
 try{
  if(req.url?.startsWith('/api/')){
   const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
   let r:Response;try{r=await api(new Request(`http://127.0.0.1:8799${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,body:body.length?body:undefined}),{DB:db} as Env);}catch(e:any){r=Response.json({detail:e.message},{status:e.status||500});}
   res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
  }
  const name=new URL(req.url!,'http://127.0.0.1').pathname.slice(1)||'index.html';if(name.includes('..'))throw new Error('Invalid path');
  const data=await readFile(new URL('../dist/'+name,import.meta.url));res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);
 }catch{res.writeHead(404);res.end();}
});
let busy=false;
const timer=setInterval(async()=>{if(busy)return;busy=true;try{const jobs=await db.prepare("SELECT id,provider FROM scan_jobs WHERE status IN ('queued','enumerating','enriching')").all<{id:string;provider:string}>();for(const j of jobs.results){await due(db);await runStep(store,j.id,{},j.provider==='generic'?{provider:fixture}:{});}}finally{busy=false;}},1200);
server.listen(8799,'127.0.0.1',()=>console.log('TEST_SERVER_READY http://127.0.0.1:8799'));
process.on('SIGTERM',async()=>{clearInterval(timer);server.close();await mf.dispose();process.exit();});
