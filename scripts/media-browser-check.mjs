import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit,firefox} from 'playwright';
const server=spawn('python',['-m','scripts.serve_media_fixture'],{stdio:['ignore','pipe','pipe']});
let logs='';server.stderr.on('data',x=>{logs+=x.toString()});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir('artifacts-v4',{recursive:true});
try{
 let healthy=false;for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:8130/health');if(r.ok){healthy=true;break}}catch{}await wait(500)}
 assert.ok(healthy,logs);
 const results=[];
 for(const [name,type] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const representation of ['sample.html','sample.m3u8','sample.mpd']){
    await page.goto('http://127.0.0.1:8130/fixture');
    await page.locator('#fixtureUrl').fill('http://fixture.example/'+representation);
    await page.locator('#analyze').click();
    await page.locator('#mediaOptions').waitFor({state:'visible',timeout:60000});
    await page.selectOption('#mediaFormat',{index:0});
    const filename='Tokyo \u6771\u4eac '+name+'.mp4';
    await page.locator('#mediaFilename').fill(filename);
    const received=page.waitForEvent('download',{timeout:60000});
    await page.locator('#mediaPrepare').click();
    const download=await received;
    assert.equal(download.suggestedFilename(),filename);
    const path='artifacts-v4/'+name+'-'+representation+'.mp4';await download.saveAs(path);
    const data=await readFile(path);assert.equal(data.subarray(4,8).toString(),'ftyp');
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path]));
    assert.ok(Number(probe.format.duration)>2.9);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
    await page.evaluate(async base64=>{
     const binary=atob(base64),array=Uint8Array.from(binary,c=>c.charCodeAt(0));
     const video=document.createElement('video');video.muted=true;video.playsInline=true;video.src=URL.createObjectURL(new Blob([array],{type:'video/mp4'}));document.body.append(video);
     await video.play();await new Promise(r=>setTimeout(r,500));if(video.currentTime<=0)throw new Error('Downloaded file did not play');video.pause();URL.revokeObjectURL(video.src);video.remove();
    },data.toString('base64'));
    const width=await page.locator('#mediaDialog').evaluate(e=>({width:e.getBoundingClientRect().width,viewport:innerWidth,scroll:e.scrollWidth,client:e.clientWidth}));
    assert.ok(width.width<=width.viewport&&width.scroll<=width.client+1);
    results.push({browser:name,representation,attachment:true,filename:true,playback:true,bytes:data.length});
   }
   assert.deepEqual(errors,[]);
  }finally{await browser.close()}
 }
 await writeFile('artifacts-v4/browser-results.json',JSON.stringify(results,null,2));
 console.log('REAL_BROWSER_DOWNLOADS',JSON.stringify(results));
}finally{server.kill('SIGTERM')}
