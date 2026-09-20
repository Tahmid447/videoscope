// Controlled live acceptance. Credentials stay in ignored local storage; reports
// are safe to upload. A network outage never deletes retained cloud progress.
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {client,validateCompletion} from './hosted-v4-client.mjs';
const site=process.env.SITE_URL,commit=process.env.GITHUB_SHA;
assert.ok(site?.startsWith('https://'),'Set SITE_URL to an explicitly deployed preview');
assert.ok(/^[a-f0-9]{40}$/.test(commit||''),'GITHUB_SHA must identify the deployed source');
await mkdir('.wrangler',{recursive:true});await mkdir('artifacts',{recursive:true});
const stateFile=process.env.HOSTED_STATE_FILE || '.wrangler/hosted-v4-state.json';
let state;
try {state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(state){assert.equal(state.site,site,'Use another HOSTED_STATE_FILE for a different preview');assert.equal(state.commit,commit,'Use a fresh HOSTED_STATE_FILE for a new build');}
else state={site,commit,workspace:randomBytes(24).toString('hex'),jobs:{},results:{}};
const api=client(site,state.workspace),config=await api('config');
assert.equal(config.backendOwnedScans,true);assert.equal(config.buildSha,commit,'Preview must run the exact acceptance commit');
const sources=[['youtube','https://www.youtube.com/@FilmiIndian/videos'],['tokyomotion-profile','https://www.tokyomotion.net/user/yua_xx/videos'],['tokyomotion-search','https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos'],['wordpress-archive','https://internetchicks.com/actress/lillian-phillips/']];
const selected=process.argv.slice(2);
for(const name of selected)assert.ok(sources.some(([n])=>n===name),`Unknown regression: ${name}`);
async function save(){
  await writeFile(stateFile+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await chmod(stateFile+'.tmp',0o600);await rename(stateFile+'.tmp',stateFile);
  const report=sources.map(([name])=>state.results[name]||{name,status:'pending'});
  await writeFile('artifacts/cloudflare-acceptance.json',JSON.stringify({site,version:config.version,commit,allRequiredPassed:report.every(r=>r.status==='pass'),report},null,2));
}
await save();
const browser=await chromium.launch({headless:true});
try{
  for(const [name,url] of sources.filter(([name])=>!selected.length||selected.includes(name))){
    if(state.results[name]?.status==='pass'){console.log(`${name}: reusing completed acceptance at this build`);continue;}
    if(name==='youtube'&&!config.providers.find(p=>p.id==='youtube').configured){state.results[name]={name,status:'blocked',message:'YOUTUBE_API_KEY is not configured; production acceptance is blocked.'};await save();continue;}
    let j;
    try{
      if(state.jobs[name])j=await api('scans/'+state.jobs[name].id);
      else{
        const detection=await api('detect',{url}),existing=(await api('collections')).find(c=>c.input_url===detection.url);
        if(existing)j=await api('scans/'+existing.job_id);
        else j=await api('scans',{url,mode:'full',enrich:name==='youtube'||name==='wordpress-archive'});
        state.jobs[name]={id:j.id,collectionId:j.collectionId};await save();
      }
      if(['queued','enumerating','enriching'].includes(j.status)){
        await api('scans/'+j.id+'/pause',{});assert.equal((await api('scans/'+j.id)).status,'paused');await api('scans/'+j.id+'/resume',{});
      }else if(j.status==='paused')await api('scans/'+j.id+'/resume',{});
      const started=Date.now();let lastLog=0;j=await api('scans/'+j.id);
      while(['queued','enumerating','enriching'].includes(j.status)){
        if(Date.now()-started>3_600_000)throw new Error('Acceptance time budget exhausted; rerun with the same local state to continue.');
        if(Date.now()-lastLog>30_000){console.log(`${name}: ${j.status}, ${j.uniqueItemsCollected} records, ${j.pagesRead} pages, ${j.enrichedCount} enriched`);lastLog=Date.now();}
        await new Promise(r=>setTimeout(r,3000));j=await api('scans/'+j.id);
      }
      validateCompletion(name,j);
      const filters=await filterAcceptance(j),coverage=(await api('collections/'+j.collectionId)).metadataCoverage;
      if(name==='youtube'){assert.ok(coverage.durationSeconds>0);assert.ok(coverage.views>0);}
      if(name==='wordpress-archive'){assert.ok(coverage.thumbnailUrl>0);assert.ok(coverage.publishedAt>0);}
      await browserAcceptance(j,name);
      state.results[name]={name,status:'pass',collectionStatus:j.status,collected:j.uniqueItemsCollected,expected:j.expectedCount,pages:j.pagesRead,requests:j.requestsMade,warnings:j.warnings,coverage,filters,viewports:[1440,375,390,430]};
      console.log(`${name}: acceptance passed; ${j.status}, ${j.uniqueItemsCollected}/${j.expectedCount??'unknown'} records`);
    }catch(e){state.results[name]={name,status:'fail',message:e.message,scanId:j?.id};console.error(`${name}: ${e.message}`);}
    finally{await save();}
  }
}finally{await browser.close();await save();}
const checked=sources.filter(([name])=>!selected.length||selected.includes(name));
if(checked.some(([name])=>state.results[name]?.status!=='pass'))throw new Error('Acceptance has failed or blocked rows; see artifacts/cloudflare-acceptance.json.');
console.log(selected.length?'Selected live checks passed; inspect allRequiredPassed before release.':'All required hosted acceptance passed.');

async function all(j,query=''){
  const items=[];let total;
  for(let page=1;;page++){
    const r=await api(`collections/${j.collectionId}/videos?${query}&pageSize=96&page=${page}`);
    total??=r.total;assert.equal(r.total,total,'Completed collection changed during filtering acceptance');
    items.push(...r.items);if(items.length>=total)break;assert.ok(r.items.length>0,'Pagination ended before the stored total');
  }
  assert.equal(items.length,total);assert.equal(new Set(items.map(v=>v.id)).size,total);return items;
}
async function filterAcceptance(j){
  const baseline=await all(j,'sort=views_desc');assert.equal(baseline.length,j.uniqueItemsCollected);
  const checks=[];
  for(const [mode,key] of [['views','views'],['published','publishedAt'],['duration','durationSeconds']])for(const direction of ['asc','desc']){
    const rows=await all(j,`sort=${mode}_${direction}`);let previous=null,unknown=false;
    for(const row of rows){const value=row[key];if(value===null){unknown=true;continue;}assert.ok(!unknown,'Known values must precede unknowns');if(previous!==null)assert.ok(direction==='asc'?previous<=value:previous>=value,`${mode} ordering`);previous=value;}
    assert.deepEqual(rows.map(v=>v.id).sort(),baseline.map(v=>v.id).sort());checks.push(`${mode}_${direction}`);
  }
  for(const [key,label]of [['views','Views'],['durationSeconds','Duration']]){
    const known=baseline.map(v=>v[key]).filter(v=>v!==null).sort((a,b)=>a-b);
    if(!known.length){assert.equal((await all(j,`min${label}=0`)).length,0);checks.push(`${label}: unknown excluded`);continue;}
    const min=known[Math.floor(known.length/4)],max=known[Math.floor(3*known.length/4)];
    const expected=baseline.filter(v=>v[key]!==null&&v[key]>=min&&v[key]<=max).map(v=>v.id).sort();
    assert.deepEqual((await all(j,`min${label}=${min}&max${label}=${max}`)).map(v=>v.id).sort(),expected);checks.push(`min/max ${label}`);
  }
  const dates=baseline.map(v=>v.publishedAt).filter(Boolean).sort();
  if(dates.length){const from=dates[Math.floor(dates.length/4)].slice(0,10),to=dates[Math.floor(3*dates.length/4)].slice(0,10),end=new Date(Date.parse(to)+86400000).toISOString();
    assert.deepEqual((await all(j,`from=${from}&to=${to}`)).map(v=>v.id).sort(),baseline.filter(v=>v.publishedAt&&v.publishedAt>=from&&v.publishedAt<end).map(v=>v.id).sort());checks.push('date range');}
  for(const key of ['title','uploader']){
    const value=baseline.find(v=>v[key])?.[key];if(!value)continue;
    const params=new URLSearchParams({[key==='title'?'q':key]:value});const rows=await all(j,params.toString());assert.ok(rows.length>0);
    if(key==='uploader')assert.ok(rows.every(v=>v.uploader?.toLocaleLowerCase().includes(value.toLocaleLowerCase())));checks.push(`${key} search`);
  }
  return checks;
}
async function browserAcceptance(j,name){
  const expected=await api(`collections/${j.collectionId}/videos?sort=views_desc`);
  for(const width of [1440,375,390,430]){
    const context=await browser.newContext({viewport:{width,height:900}});
    try{
      await context.addInitScript(({workspace,job})=>{localStorage.setItem('videoscope-workspace-v33',JSON.stringify(workspace));localStorage.setItem('videoscope-v4-last-job',JSON.stringify(job));},{workspace:state.workspace,job:j.id});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(site);
      await expect(page.locator('.video-card')).toHaveCount(expected.items.length);
      assert.deepEqual(await page.locator('.video-card').evaluateAll(cards=>cards.map(c=>c.dataset.id)),expected.items.map(v=>v.id));
      if(j.status==='partial')await expect(page.locator('#statusTitle')).toContainText('Partial coverage');
      await page.locator('[data-detail]').first().click();await expect(page.locator('#detailDialog')).toBeVisible();await page.click('[data-close="detailDialog"]');
      if(expected.total>24){await page.click('#nextResults');const next=await api(`collections/${j.collectionId}/videos?sort=views_desc&page=2`);await expect(page.locator('.video-card').first()).toHaveAttribute('data-id',next.items[0].id);}
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.deepEqual(errors,[]);
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`artifacts/hosted-${name}-${width}.png`});
    }finally{await context.close();}
  }
}
