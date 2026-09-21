import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import {client} from './hosted-v4-client.mjs';
const site=process.env.SITE_URL,commit=process.env.GITHUB_SHA,workspace=process.env.HOSTED_WORKSPACE;
assert.ok(site?.startsWith('https://'));assert.ok(workspace,'Set the private acceptance workspace');
const api=client(site,workspace),config=await api('config');assert.equal(config.buildSha,commit);
const url='https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
let job=await api('scans',{url,mode:'cached',enrich:false});const start=Date.now();
while(['queued','enumerating','enriching'].includes(job.status)){assert.ok(Date.now()-start<180000,'Direct MP4 scan timed out');await new Promise(r=>setTimeout(r,2000));job=await api('scans/'+job.id);}
assert.equal(job.status,'complete');assert.equal(job.uniqueItemsCollected,1);
const browser=await chromium.launch();let file;
try{
 const context=await browser.newContext({viewport:{width:375,height:900},acceptDownloads:true});
 await context.addInitScript(({workspace,id})=>{localStorage.setItem('videoscope-workspace-v33',JSON.stringify(workspace));localStorage.setItem('videoscope-v4-last-job',JSON.stringify(id));},{workspace,id:job.id});
 const page=await context.newPage();await page.goto(site);await expect(page.locator('.video-card')).toHaveCount(1);
 await page.locator('[data-detail]').click();await page.locator('#downloadFilename').fill('VideoScope verified flower');
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/downloads'));
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-download]').click();
 const response=await responsePromise;assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'video/mp4');assert.match(response.headers()['content-disposition'],/^attachment;/);
 const download=await downloadPromise;assert.equal(download.suggestedFilename(),'VideoScope verified flower.mp4');
 await fs.mkdir('artifacts',{recursive:true});file='artifacts/verified-download.mp4';await download.saveAs(file);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/download-mobile.png'});
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(Number(probe.format.duration)>0);
 const playback=await browser.newPage();const base64=(await fs.readFile(file)).toString('base64');
 const decoded=await playback.evaluate(async encoded=>{
  const video=document.createElement('video');video.muted=true;document.body.append(video);
  const data=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));video.src=URL.createObjectURL(new Blob([data],{type:'video/mp4'}));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Playback timeout')),15000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Error('Playback failed'));};});
  await video.play();await new Promise(r=>setTimeout(r,350));const result={width:video.videoWidth,height:video.videoHeight,time:video.currentTime};video.pause();return result;
 },base64);assert.ok(decoded.width>0&&decoded.height>0&&decoded.time>0);
 const evidence={site,commit,status:'pass',source:url,bytes:(await fs.stat(file)).size,attachment:true,filename:download.suggestedFilename(),ffprobe:{duration:Number(probe.format.duration),codecs:probe.streams.map(s=>s.codec_name)},playback:decoded,viewport:375,scope:'Public unencrypted direct MP4 up to 16 MB; platform page downloads unavailable'};
 await fs.writeFile('artifacts/download-acceptance.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();}
