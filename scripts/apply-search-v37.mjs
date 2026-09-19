// One-time branch migration. The generated edits are tested and committed before deployment.
import {readFileSync,writeFileSync} from 'node:fs';
function edit(path,fn){const input=readFileSync(path,'utf8');writeFileSync(path,fn(input));}
function once(s,from,to){if(!s.includes(from))throw new Error('Migration target not found: '+from.slice(0,100));return s.replace(from,to);}
edit('lib/extract.mjs',s=>{
 s=once(s,"export const VERSION='3.6.0';","export const VERSION='3.7.0';");
 s=once(s,"$('.video-item,.video-card,.thumb-block,.clip-card,.list-videos .item,[itemtype$=\"/VideoObject\"],article')","$('.video-item,.video-card,.thumb-block,.clip-card,.list-videos .item,[itemtype$=\"/VideoObject\"],article,.well.well-sm:has(.video-title)')");
 return s;
});
writeFileSync('lib/scanner.mjs',"// Stable scanner interface, shared by the Netlify API and tests.\nexport {makeJob,scanStep,summarize,resumeJob,advertisedPages} from './scan-engine.mjs';\n");
edit('netlify/functions/api.mts',s=>{
 s=once(s,"import {makeJob,scanStep,summarize}","import {makeJob,scanStep,summarize,resumeJob}");
 s=once(s,"max_pages:100,detail_batch:2","max_pages:1000,default_scan_mode:'all',max_records:5000,detail_batch:1");
 s=once(s,"if(j.status==='stopped'){j.status='running';await set(key,j)}return json(publicJob(j))","resumeJob(j);await set(key,j);return json(publicJob(j))");
 return s;
});
edit('static/index.html',s=>{
 s=s.replace(/3\.6\.0/g,'3.7.0').replace(/v=360/g,'v=370').replace('VideoScope 3.6 · Archive thumbnails + downloads','VideoScope 3.7 · Complete collection scans');
 s=once(s,'<option value="5">5 pages</option><option value="25" selected>25 pages</option><option value="100">100 pages</option>', '<option value="all" selected>All available pages</option><option value="5">5 pages</option><option value="25">25 pages</option><option value="100">100 pages</option>');
 s=once(s,'<button id="resumeButton" class="btn ghost" hidden>Resume</button>','<button id="resumeButton" class="btn ghost" hidden>Continue scan</button>');
 s=once(s,'<section id="status"', '<p class="fine-print scan-hint">All available pages collects the full listing before reading individual details. Keep this tab open while it runs; saved progress can be continued after a reload.</p>\n<section id="status"');
 return s;
});
edit('static/app.js',s=>{
 s=s.replace(/3\.6\.0/g,'3.7.0');
 s=once(s,"pages:Number($('scanDepth').value)","pages:$('scanDepth').value==='all'?'all':Number($('scanDepth').value)");
 s=once(s,"function showJob(job){state.job=job;","function showJob(job){state.job=job;write('videoscope-last-job-v37',job.id);");
 s=once(s,"$('resumeButton').hidden=job.status!=='stopped';","$('resumeButton').hidden=state.running||!canContinue(job);");
 const a=s.indexOf(' async function runJob(job){'),b=s.indexOf('\n async function analyze()',a);
 if(a<0||b<0)throw new Error('Missing runJob block');
 const replacement=`
 function canContinue(j){return !!j&&(['queued','running','stopped'].includes(j.status)||j.can_resume===true)}
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function stepWithRetry(job){
  let last;
  for(let attempt=0;attempt<3;attempt++){
   try{return await api('/api/scans/'+job.id+'/step',{method:'POST',body:JSON.stringify({revision:job.revision})})}
   catch(e){last=e;if(attempt<2){setStatus('','Reconnecting to the scan...', 'Collected results are preserved.');await wait(2000*(attempt+1))}}
  }
  throw last;
 }
 async function restoreSavedScan(){
  const id=read('videoscope-last-job-v37',null);if(!id||state.running||state.collection)return;
  try{
   const j=await api('/api/scans/'+encodeURIComponent(id));
   if(state.running||state.collection)return;
   if(j.collection_id)showCollection(await api('/api/collections/'+j.collection_id));
   showJob(j);
   if(canContinue(j)){setStatus('', 'Your saved scan is ready to continue.', 'Use Continue scan to keep the existing results and read the remaining pages.');$('resumeButton').hidden=false}
  }catch{}
 }
 async function runJob(job){
  state.pause=false;running(true);
  try{
   let steps=0;
   while(!['complete','partial','failed','stopped'].includes(job.status)&&steps++<10000){
    showJob(job);
    if(job.retry_after_ms)await wait(Math.min(60000,job.retry_after_ms));
    job=await stepWithRetry(job);showJob(job);
    if(job.collection_id&&(job.stage==='listing'||steps%5===0||['complete','partial','failed'].includes(job.status)))showCollection(await api('/api/collections/'+job.collection_id));
    if(state.pause&&!['complete','partial','failed'].includes(job.status)){job=await api('/api/scans/'+job.id+'/stop',{method:'POST',body:'{}'});break}
    if(!['complete','partial','failed'].includes(job.status))await wait(job.stage==='listing'?1000:350);
   }
   if(steps>=10000&&!['complete','partial','failed','stopped'].includes(job.status))job=await api('/api/scans/'+job.id+'/stop',{method:'POST',body:'{}'});
   if(job.collection_id)showCollection(await api('/api/collections/'+job.collection_id));
   showJob(job);await refreshCollections();
  }catch(e){setStatus('error','The scan paused after a connection problem',e.message+' Saved results are preserved; use Continue scan.');state.job=job;write('videoscope-last-job-v37',job.id)}
  finally{running(false);$('pauseButton').hidden=true;$('resumeButton').hidden=!canContinue(state.job);state.pause=false}
 }
`;
 s=s.slice(0,a)+replacement+s.slice(b);
 s=once(s,"refreshCollections().catch(e=>setStatus('error','Collection service unavailable',e.message));", "refreshCollections().then(restoreSavedScan).catch(e=>setStatus('error','Collection service unavailable',e.message));");
 return s;
});
edit('package.json',s=>{const p=JSON.parse(s);p.version='3.7.0';p.scripts.test='node --test tests/*.test.mjs';return JSON.stringify(p,null,2)+'\n';});
edit('scripts/ui-check.mjs',s=>s.replace(/3\.6\.0/g,'3.7.0'));
edit('scripts/hosted-check.mjs',s=>{
 s="import {VERSION} from '../lib/extract.mjs';\n"+s;
 return s.replace(/config\.version==='3\.4\.0'/g,'config.version===VERSION').replace(/version:'3\.4\.0'/g,'version:VERSION');
});
// The old download test must not test an unrelated, stale PR deployment.
edit('.github/workflows/download-check.yml',s=>s.replace('  downloads:\n','  downloads:\n    if: github.head_ref == \'fix/download-first-v35\' || github.ref_name == \'fix/download-first-v35\'\n'));
// Retries are a deliberate new state: assert eventual failure, never fake empty success.
edit('tests/metadata.test.mjs',s=>once(s,"await scanStep(j,c,async()=>{throw new Error('HTTP 403')},async()=>({origin:'https://example.com',text:''}));assert.equal(j.status,'failed')","for(let i=0;i<3;i++)await scanStep(j,c,async()=>{const e=new Error('HTTP 403');e.status=403;throw e},async()=>({origin:'https://example.com',text:''}));assert.equal(j.status,'failed')"));
console.log('Search collection migration applied.');
