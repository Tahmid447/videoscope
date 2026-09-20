// Controlled live smoke: explicit invocation only. Never runs in normal CI.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {database,due} from '../tests/v4/helpers.ts';
import {detect,providerById} from '../engine/providers/index.ts';
import {tokyoLinks} from '../engine/providers/tokyomotion.ts';
import {runStep} from '../engine/runner.ts';
import {activeStates,type Credentials} from '../engine/model.ts';
const sources=[
 ['youtube','https://www.youtube.com/@FilmiIndian/videos'],
 ['tokyomotion-profile','https://www.tokyomotion.net/user/yua_xx/videos'],
 ['tokyomotion-search','https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos'],
 ['wordpress-archive','https://internetchicks.com/actress/lillian-phillips/'],
];
const requested=process.argv.slice(2),env=process.env as Credentials,report=[];
await mkdir('artifacts',{recursive:true});
const {mf,db,store}=await database();
try{
 for(const [name,url] of sources.filter(([name])=>!requested.length||requested.includes(name))){
  if(name==='youtube'&&!env.YOUTUBE_API_KEY){report.push({name,status:'blocked',reason:'YOUTUBE_API_KEY not configured'});continue;}
  const source=detect(url),provider=providerById(source.provider);let j=await store.create('live-smoke',source,provider.capabilities(env),name==='wordpress-archive'||name==='youtube','full');
  const started=Date.now(), cursorPages:Record<string,number>={};
  const tracedProvider={...provider,enumerate:async(source:any,cursor:any,ctx:any)=>provider.enumerate(source,cursor,{...ctx,read:async(url:string,opts:any)=>{const r=await ctx.read(url,opts);if(provider.id==='tokyomotion')await appendFile(`artifacts/live-v4-${name}-pagination.jsonl`,JSON.stringify({requested:url,resolved:r.url,links:tokyoLinks(r.text,r.url,source.url)})+'\n');return r;}})};
  while(activeStates.includes(j.status)){
   const wait=Math.max(0,j.nextRunAt-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));
   // Scheduler has already waited above; this allows sequential provider execution
   // in the local smoke harness without waiting for a cron tick.
   await due(db);const previousPages=j.pagesRead;j=(await runStep(store,j.id,env,{provider:tracedProvider}))!;
   if(j.pagesRead>previousPages && j.currentCursor && typeof j.currentCursor==='object' && !Array.isArray(j.currentCursor) && typeof j.currentCursor.url==='string'){const u=new URL(j.currentCursor.url),key=u.searchParams.get('o')||'default';cursorPages[key]=(cursorPages[key]||0)+1;}
  }
  const coverage=await store.coverage(j.collectionId);
  report.push({name,url,status:j.status,expected:j.expectedCount,unique:j.uniqueItemsCollected,pages:j.pagesRead,requests:j.requestsMade,coverage,cursorPages,errors:j.errors,warnings:j.warnings,elapsedSeconds:(Date.now()-started)/1000});
  await writeFile(`artifacts/live-v4-${name}.json`,JSON.stringify(report.at(-1),null,2));
  console.log('LIVE_RESULT',JSON.stringify(report.at(-1)));
 }
}finally{await mf.dispose();await writeFile('artifacts/live-v4-results.json',JSON.stringify(report,null,2));}
if(report.some(r=>r.status!=='complete'))process.exitCode=1;
