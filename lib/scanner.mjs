import {createHash} from 'node:crypto';
import {parseListing,parseDetail,parseFeed,feedURL,VERSION} from './extract.mjs';
import {readPublic,readRobots,allowedByRobots} from './network.mjs';

export function makeJob(url,pages=25,enrich=true){return {version:VERSION,status:'queued',stage:'listing',message:'Connecting to the source...',next_url:url,page_limit:Math.min(100,Math.max(1,Number(pages)||25)),pages:0,items:0,expected:null,visited:[],fingerprints:[],queue:[],details_checked:0,details_failed:0,rejected_candidates:0,warnings:[],coverage:'not started',enrich:enrich!==false,revision:0}}
export function summarize(c){const fields=['title','thumbnail_url','views','rating','published_at','duration_seconds'];return Object.fromEntries(fields.map(k=>[k,c.items.filter(x=>x[k]!==null&&x[k]!==undefined&&x[k]!=='').length]))}
function note(job,message){if(!job.warnings.includes(message)&&job.warnings.length<15)job.warnings.push(message)}
function finishListing(job,c){job.items=c.items.length;if(job.next_url)job.coverage='page limit reached';else if(job.expected!==null&&job.items<job.expected)job.coverage='source count not reached';else job.coverage=job.expected!==null?'source count matched':'pagination exhausted';job.queue=job.queue.concat(job.enrich?c.items.filter(x=>!x.detail_fetched_at&&x.availability!=='private listing').map(x=>({id:x.id,url:x.url,candidate:false})):[]);job.stage=job.queue.length?'details':'finished';if(!job.queue.length)finish(job,c)}
function finish(job,c){job.items=c.items.length;job.stage='finished';job.status=['page limit reached','source count not reached','pagination loop stopped'].includes(job.coverage)?'partial':'complete';job.message=job.status==='partial'?'Collected '+job.items+' videos; '+job.coverage+'.':'Collected '+job.items+(job.expected!==null?' of '+job.expected:'')+' videos from '+job.pages+' source pages.';if(job.details_failed)job.message+=' '+job.details_failed+' detail pages were unavailable; listing metadata was kept.';c.coverage=job.coverage;c.expected_count=job.expected;c.metadata_coverage=summarize(c)}
export async function scanStep(job,c,read=readPublic,robots=readRobots){
 if(['complete','partial','failed','stopped'].includes(job.status))return {job,c};job.status='running';job.revision++;const at=new Date();c.updated_at=at.toISOString();
 try{
  if(job.stage==='listing'){
   const target=job.next_url;if(!target){finishListing(job,c);return {job,c}}
   if(job.visited.includes(target)){job.coverage='pagination loop stopped';note(job,'A repeated page link was ignored.');job.next_url=null;finishListing(job,c);job.coverage='pagination loop stopped';return {job,c}}
   if(!job.robots){job.robots=await robots(target);if(job.robots.warning)note(job,job.robots.warning)}
   if(!allowedByRobots(job.robots,target))throw new Error('The source disallows automated reads of this page.');
   let fetched,result,usedFeed=false;
   try{fetched=await read(target);result=/application\/(?:rss|atom)\+xml|(?:application|text)\/xml/i.test(fetched.contentType||'')?parseFeed(fetched.html,fetched.url,at):parseListing(fetched.html,fetched.url,at)}
   catch(primaryError){const fallback=feedURL(target);if(!allowedByRobots(job.robots,fallback))throw primaryError;try{fetched=await read(fallback,{html:false});result=parseFeed(fetched.html,fetched.url,at);usedFeed=true;note(job,'The normal page refused the server request, so VideoScope used the site’s public RSS/Atom feed instead.')}catch{throw primaryError}}
   job.pages++;job.visited.push(target);if(usedFeed&&!job.visited.includes(fetched.url))job.visited.push(fetched.url);c.pages=job.pages;if(job.pages===1){c.label=result.title;job.expected=result.expected;c.expected_count=result.expected}
   let incoming=result.items;
   const path=new URL(fetched.url).pathname;const isDetail=/\/(?:video|watch|clip)\/[^/]+/.test(path)||(!incoming.length&&!result.candidates.length);
   if(isDetail){const detail=parseDetail(fetched.html,fetched.url,null,at);if(detail.is_video){incoming=[detail];result.next=null;result.candidates=[];job.expected=1;c.expected_count=1}}
   if(!incoming.length&&!result.candidates.length){if(result.kind==='feed-video-list'&&job.pages>1){job.next_url=null;finishListing(job,c);return {job,c}}throw new Error('The returned page contained no verified video entries. Navigation links were rejected rather than shown as videos.');}
   const fingerprint=createHash('sha256').update(incoming.map(x=>x.id).sort().join('|')).digest('hex');
   if(incoming.length&&job.fingerprints.includes(fingerprint)){job.coverage='pagination loop stopped';job.next_url=null;note(job,'The source returned a page already collected.');finishListing(job,c);job.coverage='pagination loop stopped';return {job,c}}
   job.fingerprints.push(fingerprint);const map=new Map(c.items.map(x=>[x.id,x]));for(const v of incoming)map.set(v.id,{...map.get(v.id),...v});c.items=[...map.values()].slice(0,5000);c.item_count=c.items.length;job.items=c.items.length;
   for(const candidate of result.candidates)if(!job.queue.some(x=>x.id===candidate.id)&&!map.has(candidate.id))job.queue.push({id:candidate.id,url:candidate.url,candidate:true,item:candidate});
   job.next_url=result.next&&!job.visited.includes(result.next)?result.next:null;
   if(result.next&&job.visited.includes(result.next))note(job,'A previously visited next page was skipped.');
   job.message='Read page '+job.pages+': '+job.items+(job.expected!==null?' of '+job.expected:'')+' videos collected.';
   if(!job.next_url||job.pages>=job.page_limit||job.items>=5000)finishListing(job,c);
  }else if(job.stage==='details'){
   const batch=job.queue.splice(0,2);
   for(const task of batch){
    const index=c.items.findIndex(x=>x.id===task.id),existing=index>=0?c.items[index]:task.item;
    try{if(!allowedByRobots(job.robots,task.url))throw new Error('Detail page not allowed by source crawl instructions.');const fetched=await read(task.url);const detail=parseDetail(fetched.html,fetched.url,existing,at);if(detail.is_video){if(index>=0)c.items[index]=detail;else c.items.push(detail)}else if(task.candidate)job.rejected_candidates++;else if(index>=0)c.items[index].detail_status='No public detail metadata returned'}catch(e){job.details_failed++;if(index>=0)c.items[index].detail_status=e.message;note(job,'Some details could not be read; source listing values were preserved.')}
    job.details_checked++;
   }
   c.item_count=c.items.length;job.items=c.items.length;job.message='Collected '+job.items+' videos. Reading details '+job.details_checked+'/'+(job.details_checked+job.queue.length)+'...';
   if(!job.queue.length){if(job.coverage==='source count not reached'&&job.expected===job.items)job.coverage='source count matched';finish(job,c)}
  }
 }catch(e){job.status=c.items.length?'partial':'failed';job.message=e.message;job.coverage='source request incomplete';note(job,e.message)}
 c.job_id=job.id;c.item_count=c.items.length;c.metadata_coverage=summarize(c);c.expected_count=job.expected;c.coverage=job.coverage;c.scan_status=job.status;return {job,c};
}
