import assert from 'node:assert/strict';
import {readPublic} from '../lib/network.mjs';
import {parseFeed,wordpressPostURL,parseWordPressPostMeta} from '../lib/extract.mjs';

const base='https://deploy-preview-4--videoscope-3-tahmid.netlify.app';
const workspace='ci-v36-archive-thumb-integrated-20260919';
const headers={'content-type':'application/json','x-videoscope-workspace':workspace};
async function req(path,opts={}){
 const r=await fetch(base+path,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(55000)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw new Error(path+' non-JSON '+r.status+' '+text.slice(0,200))}
 if(!r.ok)throw new Error(path+' '+r.status+' '+JSON.stringify(data));return data
}
const cfg=await req('/api/config');assert.equal(cfg.version,'3.6.0');console.log('CONFIG',JSON.stringify(cfg));

// End-to-end: one real feed page, including detail-stage WordPress fallback.
let job=await req('/api/scans',{method:'POST',body:JSON.stringify({url:'https://internetchicks.com/actress/lillian-phillips/',pages:1,enrich:true,start_at_first:true})});
for(let i=0;i<80&&!['complete','partial','failed','stopped'].includes(job.status);i++)job=await req('/api/scans/'+job.id+'/step',{method:'POST',body:JSON.stringify({revision:job.revision})});
const one=await req('/api/collections/'+job.collection_id);
const oneThumbs=one.items.filter(x=>x.thumbnail_url).length,oneWp=one.items.filter(x=>x.field_sources?.thumbnail_url==='public WordPress featured image API').length;
console.log('INTEGRATED_THUMBNAILS',JSON.stringify({status:job.status,items:one.items.length,thumbnails:oneThumbs,wpThumbnails:oneWp,sample:one.items.slice(0,3).map(x=>({title:x.title,thumb:x.thumbnail_url}))}));
assert.equal(one.items.length,10);assert.equal(oneThumbs,10);assert.equal(oneWp,10);
await req('/api/collections/'+job.collection_id,{method:'DELETE'}).catch(()=>{});

// Source sweep: prove every post currently in the 11-page archive has a public featured image.
let total=0,thumbs=0;
for(let page=1;page<=20;page++){
 const u=new URL('https://internetchicks.com/actress/lillian-phillips/feed/');if(page>1)u.searchParams.set('paged',String(page));
 let feed;try{feed=await readPublic(u.href,{html:false,limit:4_000_000,timeout:20000})}catch(e){if(page>1)break;throw e}
 const parsed=parseFeed(feed.html,feed.url);if(!parsed.items.length)break;
 for(const item of parsed.items){
  total++;
  const api=wordpressPostURL(item.url),x=await readPublic(api,{html:false,limit:2_000_000,timeout:15000}),meta=parseWordPressPostMeta(x.html,x.url);
  if(meta?.thumbnail_url)thumbs++;
 }
 console.log('SOURCE_PAGE',JSON.stringify({page,items:parsed.items.length,total,thumbs}));
 if(parsed.items.length<10)break;
}
console.log('ARCHIVE_SOURCE_THUMBNAILS',JSON.stringify({total,thumbs}));
assert.equal(total,109);assert.equal(thumbs,109);
console.log('ARCHIVE_THUMBNAILS_VERIFIED');
