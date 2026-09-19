import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const site=process.env.SITE_URL,preview=process.env.GITHUB_EVENT_NAME==='pull_request';
const source='https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos';
assert.ok(site,'SITE_URL is required');
const workspace=randomUUID().replace(/-/g,''),headers={'content-type':'application/json','x-videoscope-workspace':workspace};
async function call(path,body){let last;for(let i=0;i<3;i++){try{const r=await fetch(site+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(55000)});const x=await r.json();if(!r.ok)throw new Error(path+': '+(x.detail||r.status));return x}catch(e){last=e;await new Promise(r=>setTimeout(r,1500*(i+1)))}}throw last}
let ready=false;for(let i=0;i<40;i++){try{if((await call('/api/config')).version==='3.7.0'){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,5000))}assert.ok(ready,'Hosted 3.7.0 did not become ready');
let job=await call('/api/scans',{url:source,pages:'all',enrich:false,start_at_first:true});
job=await call('/api/scans/'+job.id+'/step',{revision:job.revision});assert.ok(job.items>0,'First search page must contain real video records');
await call('/api/scans/'+job.id+'/stop',{});
const saved=await call('/api/collections/'+job.collection_id);assert.ok(saved.items.length>0);
const browser=await chromium.launch(),ctx=await browser.newContext({viewport:{width:390,height:844}});
await ctx.addInitScript(({workspace,id})=>{localStorage.setItem('videoscope-workspace-v33',JSON.stringify(workspace));localStorage.setItem('videoscope-last-job-v37',JSON.stringify(id));},{workspace,id:job.id});
const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
// Metadata only: source media bodies are neither loaded nor copied into logs.
await page.route('**/*',r=>['image','media'].includes(r.request().resourceType())?r.abort():r.continue());
await mkdir('artifacts-search',{recursive:true});
try{
 await page.goto(site,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#resumeButton',{state:'visible',timeout:30000});
 assert.equal(await page.locator('#scanDepth').inputValue(),'all');
 await page.click('#resumeButton');await page.waitForFunction(()=>document.querySelector('#scanButton').disabled);
 if(preview){
  // The preflight already checks the full real source. Preview validates the
  // deployed parser, storage and pause/resume without repeating 250 requests.
  await page.waitForFunction(n=>Number(document.querySelector('#statVideos').textContent.replace(/,/g,''))>n,saved.items.length,{timeout:90000});
  await page.click('#pauseButton');
 }
 await page.waitForFunction(()=>!document.querySelector('#scanButton').disabled,null,{timeout:900000});
 job=await call('/api/scans/'+job.id);
 if(!preview&&job.status==='partial'&&job.can_resume){
  await page.click('#resumeButton');await page.waitForFunction(()=>document.querySelector('#scanButton').disabled);
  await page.waitForFunction(()=>!document.querySelector('#scanButton').disabled,null,{timeout:600000});job=await call('/api/scans/'+job.id);
 }
 const c=await call('/api/collections/'+job.collection_id);
 const report={site,version:'3.7.0',mode:preview?'hosted search/resume smoke test':'full production search',tested_at:new Date().toISOString(),source,reported:job.expected,records:c.items.length,unique:new Set(c.items.map(x=>x.id)).size,pages:job.pages,status:job.status,coverage:job.coverage,alternate_sort_passes:job.alternate_passes||0,gaps:c.page_gaps||[],fields:c.metadata_coverage,restored_after_reload:true,all_mode_default:true,browser_errors:errors};
 await writeFile('artifacts-search/hosted-search.json',JSON.stringify(report,null,2));console.log('HOSTED_SEARCH',JSON.stringify(report));
 assert.equal(c.items.length,report.unique);
 if(preview)assert.ok(c.items.length>saved.items.length,'Continue must advance the saved search');
 else {assert.equal(c.items.length,job.expected,'The live search must reach its reported total');assert.equal(job.status,'complete');assert.ok(c.items.length>1000);}
 assert.equal(c.metadata_coverage.title,c.items.length);assert.equal(c.metadata_coverage.views,c.items.length);
 assert.equal(await page.locator('.video-card').count(),Math.min(24,c.items.length));
 await page.selectOption('#sort','views_desc');
 assert.equal(await page.locator('.card-title').first().textContent(),[...c.items].sort((a,b)=>b.views-a.views||a.title.localeCompare(b.title))[0].title);
 if(c.items.length>24){await page.click('#nextResults');assert.ok(await page.locator('.video-card').count()>0)}
 await page.click('#themeButton');assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 report.full_collection_sorting=true;report.mobile_controls=true;await writeFile('artifacts-search/hosted-search.json',JSON.stringify(report,null,2));
 console.log('HOSTED_SEARCH_UI_VERIFIED',JSON.stringify(report));
}catch(e){
 const diagnostic={error:e.message,shown_count:await page.locator('#statVideos').textContent().catch(()=>null),shown_status:await page.locator('#statusTitle').textContent().catch(()=>null)};
 await writeFile('artifacts-search/error.json',JSON.stringify(diagnostic,null,2));console.log('HOSTED_SEARCH_ERROR',JSON.stringify(diagnostic));throw e;
}finally{await browser.close();await fetch(site+'/api/collections/'+job.collection_id,{method:'DELETE',headers}).catch(()=>{});}
