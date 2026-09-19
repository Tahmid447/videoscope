import assert from 'node:assert/strict';
const base='https://deploy-preview-2--videoscope-3-tahmid.netlify.app';
const workspace='ci-preview-v34-archive-check-20260919';
const headers={'content-type':'application/json','x-videoscope-workspace':workspace};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(path,opts={}){
 const r=await fetch(base+path,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(55000)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw new Error(path+' non-JSON '+r.status+' '+text.slice(0,300))}
 if(!r.ok)throw new Error(path+' '+r.status+' '+JSON.stringify(data));return data;
}
for(let i=0;i<24;i++){try{const c=await req('/api/config');if(c.version==='3.4.1')break}catch{}if(i===23)throw new Error('Preview did not reach VideoScope 3.4');await sleep(5000)}
async function scan(url,pages){
 let job=await req('/api/scans',{method:'POST',body:JSON.stringify({url,pages,enrich:false,start_at_first:true})});
 for(let i=0;i<80&&!['complete','partial','failed','stopped'].includes(job.status);i++)job=await req('/api/scans/'+job.id+'/step',{method:'POST',body:JSON.stringify({revision:job.revision})});
 const c=await req('/api/collections/'+job.collection_id);
 console.log('HOSTED_SCAN',JSON.stringify({url,status:job.status,pages:job.pages,items:c.items.length,coverage:c.coverage,warnings:job.warnings,dates:c.items.filter(x=>x.published_at).length,players:c.items.filter(x=>x.players?.length).length}));
 await req('/api/collections/'+job.collection_id,{method:'DELETE'});
 return {job,c};
}
const archive=await scan('https://internetchicks.com/actress/lillian-phillips/',4);
assert.equal(archive.c.items.length,40);
assert.equal(archive.c.items.filter(x=>x.published_at).length,40);
assert.ok(archive.c.items.filter(x=>x.players?.length).length>=30);
assert.ok(archive.job.warnings.some(x=>/RSS\/Atom feed/.test(x)));
const tokyo=await scan('https://www.tokyomotion.net/user/yua_xx/videos',1);
assert.equal(tokyo.c.items.length,18);
assert.ok(tokyo.c.items.every(x=>x.title&&!/^(EN|Login|More|Favorite Videos)$/.test(x.title)));
console.log('PREVIEW_341_VERIFIED');
