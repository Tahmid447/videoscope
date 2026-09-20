// Controlled acceptance against an explicitly deployed preview. No fixture injection.
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const site=process.env.SITE_URL;if(!site?.startsWith('https://'))throw new Error('Set SITE_URL to the Cloudflare preview HTTPS URL.');
const workspace=randomBytes(24).toString('hex'),headers={'x-videoscope-workspace':workspace,'content-type':'application/json'};
const api=async(path,body,method)=>{const r=await fetch(site+'/api/'+path,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.detail||`HTTP ${r.status}`);return data;};
const config=await api('config');assert.equal(config.backendOwnedScans,true);assert.ok(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''),'GITHUB_SHA must identify the tested release commit');assert.equal(config.buildSha,process.env.GITHUB_SHA,'Preview must run the exact acceptance commit');
const sources=[['youtube','https://www.youtube.com/@FilmiIndian/videos'],['tokyomotion-profile','https://www.tokyomotion.net/user/yua_xx/videos'],['tokyomotion-search','https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos'],['wordpress-archive','https://internetchicks.com/actress/lillian-phillips/']];
const report=[];await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
for(const [name,url]of sources){if(name==='youtube'&&!config.providers.find(p=>p.id==='youtube').configured){report.push({name,status:'blocked',message:'YOUTUBE_API_KEY is not configured; production acceptance is blocked.'});continue;}let j=await api('scans',{url,mode:'full',enrich:name==='youtube'||name==='wordpress-archive'});const started=Date.now();
 try{
  await api('scans/'+j.id+'/pause',{});assert.equal((await api('scans/'+j.id)).status,'paused');await api('scans/'+j.id+'/resume',{});
  while(!['complete','partial','failed','cancelled'].includes(j.status)){if(Date.now()-started>3_600_000)throw new Error('Hosted scan exceeded the acceptance time budget; saved progress is retained.');await new Promise(r=>setTimeout(r,3000));j=await api('scans/'+j.id);}
  assert.equal(j.status,'complete',JSON.stringify({name,errors:j.errors,warnings:j.warnings}));assert.ok(j.uniqueItemsCollected>0);
  let last=Infinity,count=0;for(let page=1;;page++){const r=await api(`collections/${j.collectionId}/videos?pageSize=96&page=${page}&sort=views_desc`);for(const v of r.items){if(v.views!==null){assert.ok(v.views<=last);last=v.views;}}count+=r.items.length;if(count>=r.total)break;}assert.equal(count,j.uniqueItemsCollected);
  const coverage=(await api('collections/'+j.collectionId)).metadataCoverage;
  if(name==='youtube'){assert.ok(coverage.durationSeconds>0);assert.ok(coverage.views>0);}
  if(name==='wordpress-archive')assert.ok(coverage.thumbnailUrl>0);
  await browserAcceptance(j,name);
  report.push({name,status:'pass',collected:j.uniqueItemsCollected,expected:j.expectedCount,pages:j.pagesRead,coverage});
 }catch(e){report.push({name,status:'fail',message:e.message,job:j});}
 finally{await api('scans/'+j.id+'/cancel',{});await api('collections/'+j.collectionId,null,'DELETE');await writeFile('artifacts/cloudflare-acceptance.json',JSON.stringify({site,version:config.version,report,commit:process.env.GITHUB_SHA},null,2));}
}
await browser.close();
if(report.some(r=>r.status!=='pass'))throw new Error('Preview acceptance failed. See artifacts/cloudflare-acceptance.json.');
console.log('All configured live preview acceptance sources passed.');

async function browserAcceptance(j,name){
 const expected=await api(`collections/${j.collectionId}/videos?sort=views_desc`);
 for(const width of [1440,375,390,430]){
  const context=await browser.newContext({viewport:{width,height:900}});
  try{
   await context.addInitScript(({workspace,job})=>{localStorage.setItem('videoscope-workspace-v33',JSON.stringify(workspace));localStorage.setItem('videoscope-v4-last-job',JSON.stringify(job));},{workspace,job:j.id});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(site);
   await expect(page.locator('.video-card')).toHaveCount(expected.items.length);
   assert.deepEqual(await page.locator('.video-card').evaluateAll(cards=>cards.map(c=>c.dataset.id)),expected.items.map(v=>v.id));
   await page.locator('[data-detail]').first().click();await expect(page.locator('#detailDialog')).toBeVisible();await page.click('[data-close="detailDialog"]');
   if(expected.total>24){await page.click('#nextResults');const next=await api(`collections/${j.collectionId}/videos?sort=views_desc&page=2`);await expect(page.locator('.video-card').first()).toHaveAttribute('data-id',next.items[0].id);}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.deepEqual(errors,[]);
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`artifacts/hosted-${name}-${width}.png`});
  }finally{await context.close();}
 }
}
