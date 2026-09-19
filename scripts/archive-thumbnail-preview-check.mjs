import assert from 'node:assert/strict';
const base='https://deploy-preview-4--videoscope-3-tahmid.netlify.app';
const workspace='ci-v36-archive-thumbnails-20260919';
const headers={'content-type':'application/json','x-videoscope-workspace':workspace};
async function req(path,opts={}){
 const r=await fetch(base+path,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(55000)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw new Error(path+' non-JSON '+r.status+' '+text.slice(0,200))}
 if(!r.ok)throw new Error(path+' '+r.status+' '+JSON.stringify(data));return data
}
const cfg=await req('/api/config');assert.equal(cfg.version,'3.6.0');console.log('CONFIG',JSON.stringify(cfg));
let job=await req('/api/scans',{method:'POST',body:JSON.stringify({url:'https://internetchicks.com/actress/lillian-phillips/',pages:25,enrich:true,start_at_first:true})});
for(let i=0;i<1200&&!['complete','partial','failed','stopped'].includes(job.status);i++){
 job=await req('/api/scans/'+job.id+'/step',{method:'POST',body:JSON.stringify({revision:job.revision})});
 if(i%20===0)console.log('STEP',JSON.stringify({i,status:job.status,stage:job.stage,pages:job.pages,items:job.items,details:job.details_checked,remaining:job.queue?.length}))
}
const c=await req('/api/collections/'+job.collection_id);
const thumbs=c.items.filter(x=>x.thumbnail_url).length,wpThumbs=c.items.filter(x=>x.field_sources?.thumbnail_url==='public WordPress featured image API').length;
console.log('ARCHIVE_THUMBNAILS',JSON.stringify({status:job.status,pages:job.pages,items:c.items.length,thumbnails:thumbs,wpThumbnails:wpThumbs,coverage:c.coverage,warnings:job.warnings?.slice(0,5),sample:c.items.slice(0,3).map(x=>({title:x.title,thumb:x.thumbnail_url,source:x.field_sources?.thumbnail_url}))}));
assert.equal(c.items.length,109,'expected full archive collection');
assert.equal(thumbs,109,'every archive record should recover a real thumbnail');
assert.equal(wpThumbs,109,'all thumbnails should be attributed to the public WordPress featured-image API');
await req('/api/collections/'+job.collection_id,{method:'DELETE'}).catch(()=>{});
console.log('ARCHIVE_THUMBNAILS_VERIFIED');
