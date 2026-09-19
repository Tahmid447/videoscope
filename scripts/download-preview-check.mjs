import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base='https://deploy-preview-3--videoscope-3-tahmid.netlify.app';
const workspace='ci-v35-download-check-20260919';
const headers={'content-type':'application/json','x-videoscope-workspace':workspace};
async function req(path,opts={}){
 const r=await fetch(base+path,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(55000)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw new Error(path+' non-JSON '+r.status+' '+text.slice(0,220))}
 if(!r.ok)throw new Error(path+' '+r.status+' '+JSON.stringify(data));return data;
}
const config=await req('/api/config');console.log('CONFIG',JSON.stringify(config));assert.equal(config.version,'3.5.0');
let job=await req('/api/scans',{method:'POST',body:JSON.stringify({url:'https://www.tokyomotion.net/user/yua_xx/videos',pages:1,enrich:true,start_at_first:true})});
for(let i=0;i<120&&!['complete','partial','failed','stopped'].includes(job.status);i++)job=await req('/api/scans/'+job.id+'/step',{method:'POST',body:JSON.stringify({revision:job.revision})});
const c=await req('/api/collections/'+job.collection_id);
const downloadable=c.items.filter(x=>(x.download_links?.length||0)+(x.source_files?.length||0)>0);
console.log('DOWNLOAD_METADATA',JSON.stringify({items:c.items.length,downloadable:downloadable.length,sourceFiles:downloadable.reduce((a,x)=>a+(x.source_files?.length||0),0),downloadLinks:downloadable.reduce((a,x)=>a+(x.download_links?.length||0),0),sample:downloadable[0]&&{title:downloadable[0].title,files:downloadable[0].source_files?.map(x=>x.url)}}));
assert.ok(downloadable.length>=1,'real enriched source should expose at least one downloadable media record');

const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.addInitScript(({workspace})=>localStorage.setItem('videoscope-workspace-v33',JSON.stringify(workspace)),{workspace});
await page.goto(base,{waitUntil:'networkidle'});
await page.waitForFunction(()=>document.querySelectorAll('#recentCollections .recent-item').length>0,{timeout:30000});
await page.locator('#recentCollections .recent-item').first().click();
await page.waitForFunction(()=>document.querySelectorAll('.video-card').length>0,{timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('.video-card .download-action').length>0,{timeout:30000});
const downloadCount=await page.locator('.video-card .download-action').count();
console.log('DOWNLOAD_UI',JSON.stringify({downloadButtons:downloadCount,cards:await page.locator('.video-card').count()}));
assert.ok(downloadCount>=1,'Download button should be visible on at least one real video card');
const first=page.locator('.video-card .download-action').first();const href=await first.getAttribute('href'),downloadAttr=await first.getAttribute('download');console.log('DOWNLOAD_LINK',JSON.stringify({href,downloadAttr}));assert.ok(/^https?:\/\//.test(href||''));assert.ok(downloadAttr!==null);
await browser.close();
await req('/api/collections/'+job.collection_id,{method:'DELETE'}).catch(()=>{});
console.log('DOWNLOAD_PREVIEW_VERIFIED');
