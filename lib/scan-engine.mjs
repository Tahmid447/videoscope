import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {parseListing,parseDetail,parseFeed,feedURL,wordpressPostURL,parseWordPressPostMeta,VERSION} from './extract.mjs';
import {readPublic,readRobots,allowedByRobots} from './network.mjs';

const MAX_PAGES=1000,MAX_ITEMS=5000,MAX_RETRIES=2;
const terminal=new Set(['complete','partial','failed','stopped']);
const countKeys=['title','thumbnail_url','views','rating','published_at','duration_seconds'];
export function summarize(c){return Object.fromEntries(countKeys.map(k=>[k,c.items.filter(x=>x[k]!==null&&x[k]!==undefined&&x[k]!=='').length]));}
export function makeJob(url,pages='all',enrich=true){
 const all=pages==='all'||pages===undefined||pages===null;
 return {version:VERSION,status:'queued',stage:'listing',message:'Connecting to the source...',next_url:url,
  scan_mode:all?'all':'limited',page_limit:all?MAX_PAGES:Math.min(MAX_PAGES,Math.max(1,Number(pages)||25)),
  pages:0,items:0,expected:null,visited:[],fingerprints:[],pending_pages:[],page_gaps:[],attempts:{},queue:[],
  details_checked:0,details_failed:0,rejected_candidates:0,warnings:[],coverage:'not started',enrich:enrich!==false,
  revision:0,retry_after_ms:0,can_resume:false,source_count_history:[],record_limit:MAX_ITEMS};
}
function note(j,s){if(!j.warnings.includes(s)&&j.warnings.length<15)j.warnings.push(s);}
function pageNumber(raw){const u=new URL(raw);return Number(u.searchParams.get('page')||u.searchParams.get('paged')||u.pathname.match(/\/page\/(\d+)/)?.[1]||1);}
function normalizePath(u){return u.pathname.replace(/\/page\/\d+\/?$/,'/').replace(/\/$/,'');}
export function advertisedPages(html,base){
 const $=load(html),current=new URL(base),result=new Set(),currentNo=pageNumber(base);
 $('a[rel~="next"],.pagination a[href],.nav-links a[href],a.page-numbers,a.next').each((_,n)=>{
  const a=$(n);if(a.closest('.disabled').length)return;
  try{
   const u=new URL(a.attr('href'),base);u.hash='';
   if(u.origin!==current.origin||normalizePath(u)!==normalizePath(current)||u.username||u.password)return;
   for(const [key,value] of current.searchParams)if(!['page','paged'].includes(key)&&!key.startsWith('utm_')&&u.searchParams.get(key)!==value)return;
   for(const [key,value] of u.searchParams)if(!['page','paged'].includes(key)&&!key.startsWith('utm_')&&current.searchParams.get(key)!==value)return;
   const p=pageNumber(u.href);if(p>currentNo&&p<=MAX_PAGES)result.add(u.href);
  }catch{}
 });
 return [...result].sort((a,b)=>pageNumber(a)-pageNumber(b));
}
function init(j){
 j.pending_pages??=[];j.page_gaps??=[];j.attempts??={};j.visited??=[];j.fingerprints??=[];j.queue??=[];
 j.warnings??=[];j.source_count_history??=[];j.record_limit??=MAX_ITEMS;
}
function addPages(j,links){
 const pending=new Set(j.pending_pages);
 for(const u of links)if(u&&u!==j.next_url&&!j.visited.includes(u)&&!j.page_gaps.some(g=>g.url===u))pending.add(u);
 j.pending_pages=[...pending].sort((a,b)=>pageNumber(a)-pageNumber(b));
}
function advance(j){j.next_url=j.pending_pages.shift()||null;}
function coverage(j,c){
 if(c.items.length>=MAX_ITEMS&&(j.next_url||j.pending_pages.length))return 'record safety limit reached';
 if(j.next_url||j.pending_pages.length)return 'page limit reached';
 if(j.page_gaps.length)return 'some source pages unavailable';
 if(j.expected!==null&&c.items.length<j.expected)return 'source count not reached';
 if(j.expected!==null&&c.items.length>j.expected)return 'source count changed during scan';
 return j.expected!==null?'source count matched':'pagination exhausted';
}
function finish(j,c){
 j.items=c.items.length;j.stage='finished';j.coverage=coverage(j,c);
 j.can_resume=!!j.next_url||j.pending_pages.length>0||j.page_gaps.length>0;
 const incomplete=!['source count matched','pagination exhausted'].includes(j.coverage);
 j.status=incomplete?'partial':'complete';
 j.message='Collected '+j.items+(j.expected!==null?' of '+j.expected+' reported':'')+' videos from '+j.pages+' source pages.';
 if(incomplete)j.message+=' '+j.coverage+'.';
 if(j.details_failed)j.message+=' '+j.details_failed+' detail pages were unavailable; listing metadata was kept.';
 j.retry_after_ms=0;
}
function finishListing(j,c){
 j.items=c.items.length;j.coverage=coverage(j,c);
 const queued=new Set(j.queue.map(t=>t.id));
 if(j.enrich)for(const x of c.items)if(!x.detail_fetched_at&&!x.detail_attempted_at&&x.availability!=='private listing'&&!queued.has(x.id)){
  j.queue.push({id:x.id,url:x.url,candidate:false});queued.add(x.id);
 }
 j.stage=j.queue.length?'details':'finished';if(!j.queue.length)finish(j,c);
}
function persist(j,c){
 c.job_id=j.id;c.pages=j.pages;c.item_count=c.items.length;c.metadata_coverage=summarize(c);
 c.expected_count=j.expected;c.coverage=j.coverage;c.scan_status=j.status;
 c.page_gaps=j.page_gaps.map(g=>({page:g.page,reason:g.reason}));
 j.items=c.items.length;j.can_resume=j.status==='stopped'||(!['complete'].includes(j.status)&&(!!j.next_url||j.pending_pages.length>0||j.page_gaps.length>0||j.queue.length>0));
 return {job:j,c};
}
function mayTryFeed(url){const u=new URL(url);return !u.searchParams.has('search_query')&&!/\/search\/?$/.test(u.pathname);}
async function readListing(target,read,j,at){
 if(/\/feed\/?$/.test(new URL(target).pathname)){
  const f=await read(target,{html:false,timeout:10000});return {fetched:f,result:parseFeed(f.html,f.url,at),feed:true};
 }
 let primary,fetched,result;
 try{fetched=await read(target,{timeout:10000});result=/application\/(?:rss|atom)\+xml|(?:application|text)\/xml/i.test(fetched.contentType||'')?parseFeed(fetched.html,fetched.url,at):parseListing(fetched.html,fetched.url,at);}catch(e){primary=e;}
 if((primary||(!result.items.length&&!result.candidates.length))&&mayTryFeed(target)){
  const fallback=feedURL(target);
  if(allowedByRobots(j.robots,fallback))try{
   const f=await read(fallback,{html:false,timeout:10000}),p=parseFeed(f.html,f.url,at);
   if(p.items.length){note(j,'The site\'s public RSS/Atom feed supplied this collection.');return {fetched:f,result:p,feed:true};}
  }catch{}
 }
 if(primary)throw primary;
 return {fetched,result,feed:result.kind==='feed-video-list'};
}
function gap(j,target,reason){
 if(!j.visited.includes(target))j.visited.push(target);
 j.pages++;
 if(!j.page_gaps.some(g=>g.url===target))j.page_gaps.push({url:target,page:pageNumber(target),reason});
 delete j.attempts[target];
 note(j,'Some advertised source pages returned no usable records. Other advertised pages were still checked.');
 advance(j);
}
export function resumeJob(j){
 init(j);
 if(j.status==='complete')return j;
 if(j.status==='stopped'||j.status==='running'||j.status==='queued'){j.status='running';j.retry_after_ms=0;return j;}
 if(j.stage==='finished'||!j.next_url){
  const retry=j.page_gaps.map(g=>g.url),remaining=[j.next_url,...j.pending_pages,...retry].filter(Boolean);
  if(remaining.length){
   j.visited=j.visited.filter(u=>!retry.includes(u));j.page_gaps=[];
   j.pending_pages=[...new Set(remaining)].sort((a,b)=>pageNumber(a)-pageNumber(b));advance(j);j.stage='listing';
  }else if(j.queue.length)j.stage='details';else return j;
 }
 if(j.stage==='listing'&&(j.pages>=j.page_limit||j.scan_mode==='limited')){j.scan_mode='all';j.page_limit=Math.min(MAX_PAGES,j.pages+MAX_PAGES);}
 j.status='running';j.attempts={};j.retry_after_ms=0;j.message='Continuing with saved results.';return j;
}
export async function scanStep(j,c,read=readPublic,robots=readRobots){
 if(terminal.has(j.status))return {job:j,c};
 init(j);j.status='running';j.revision++;j.retry_after_ms=0;const at=new Date();c.updated_at=at.toISOString();
 try{
  if(j.stage==='listing'){
   if(!j.next_url){advance(j);if(!j.next_url){finishListing(j,c);return persist(j,c);}}
   const target=j.next_url;
   if(j.visited.includes(target)){advance(j);if(!j.next_url)finishListing(j,c);return persist(j,c);}
   if(!j.robots){j.robots=await robots(target);if(j.robots.warning)note(j,j.robots.warning);}
   if(!allowedByRobots(j.robots,target))throw new Error('The source disallows automated reads of this page.');
   let fetched,result,feed;
   try{
    ({fetched,result,feed}=await readListing(target,read,j,at));
    const advertised=feed?[result.next].filter(Boolean):advertisedPages(fetched.html,fetched.url);
    addPages(j,[...advertised,result.next].filter(Boolean));
    if(Number.isFinite(result.expected)){
     if(!j.source_count_history.includes(result.expected))j.source_count_history.push(result.expected);
     if(j.expected===null)j.expected=result.expected;
     else if(j.expected!==result.expected)note(j,'The source total changed during this scan. Counts are a snapshot, not an invented total.');
    }
    if(!c.label||j.pages===0)c.label=result.title;
    const detailPath=/\/(?:video|watch|clip)\/[^/]+/.test(new URL(fetched.url).pathname);
    if(!feed&&(detailPath||(!result.items.length&&!result.candidates.length&&!j.expected))){
     const detail=parseDetail(fetched.html,fetched.url,null,at);
     if(detail.is_video){result.items=[detail];result.candidates=[];j.pending_pages=[];result.next=null;j.expected=1;}
    }
    if(!result.items.length&&!result.candidates.length){
     if(feed&&j.pages>0){j.visited.push(target);j.pages++;advance(j);if(!j.next_url)finishListing(j,c);return persist(j,c);}
     const e=new Error('This advertised source page returned no video records.');e.empty=true;throw e;
    }
   }catch(e){
    const attempt=j.attempts[target]||0;
    const transient=e.empty||![401,403,404].includes(e.status);
    if(transient&&attempt<MAX_RETRIES){
     j.attempts[target]=attempt+1;j.retry_after_ms=e.status===429?30000:Math.min(10000,2000*(attempt+1));
     j.message='Retrying source page '+pageNumber(target)+'; '+c.items.length+' videos are preserved.';return persist(j,c);
    }
    if(c.items.length||j.pending_pages.length){
     gap(j,target,e.message);j.message='Source page '+pageNumber(target)+' was unavailable; continuing with other advertised pages.';
     if(!j.next_url||j.pages>=j.page_limit)finishListing(j,c);return persist(j,c);
    }
    throw e;
   }
   delete j.attempts[target];j.visited.push(target);
   if(feed&&fetched.url!==target&&!j.visited.includes(fetched.url))j.visited.push(fetched.url);
   j.pages++;
   const fp=createHash('sha256').update(result.items.map(x=>x.id).sort().join('|')).digest('hex');
   const duplicate=result.items.length&&j.fingerprints.includes(fp);
   if(duplicate){j.page_gaps.push({url:target,page:pageNumber(target),reason:'Repeated result page'});note(j,'A repeated result page was not counted twice.');}
   else{
    j.fingerprints.push(fp);const map=new Map(c.items.map(x=>[x.id,x]));
    for(const v of result.items){if(!map.has(v.id)&&map.size>=MAX_ITEMS)break;map.set(v.id,{...map.get(v.id),...v});}
    c.items=[...map.values()];
    for(const v of result.candidates)if(!j.queue.some(t=>t.id===v.id)&&!map.has(v.id))j.queue.push({id:v.id,url:v.url,candidate:true,item:v});
   }
   advance(j);j.message='Read '+j.pages+' source pages: '+c.items.length+(j.expected!==null?' of '+j.expected+' reported':'')+' videos collected.';
   if(!j.next_url||j.pages>=j.page_limit||c.items.length>=MAX_ITEMS)finishListing(j,c);
  }else if(j.stage==='details'){
   const task=j.queue.shift();
   if(!task){finish(j,c);return persist(j,c);}
   const index=c.items.findIndex(x=>x.id===task.id),existing=index>=0?c.items[index]:task.item;let detailError=null;
   try{
    if(!allowedByRobots(j.robots,task.url))throw new Error('Detail page not allowed by source crawl instructions.');
    const f=await read(task.url,{timeout:10000}),detail=parseDetail(f.html,f.url,existing,at);
    if(detail.is_video){if(index>=0)c.items[index]=detail;else c.items.push(detail);}
    else if(task.candidate)j.rejected_candidates++;else if(index>=0)c.items[index].detail_status='No public detail metadata returned';
   }catch(e){detailError=e;}
   const current=index>=0?c.items[index]:existing;
   if(current){
    current.detail_attempted_at=at.toISOString();
    if(!current.thumbnail_url)try{
     const url=wordpressPostURL(task.url);if(url){const rules=await robots(url);if(allowedByRobots(rules,url)){
      const wp=await read(url,{html:false,timeout:10000}),meta=parseWordPressPostMeta(wp.html,wp.url);
      if(meta?.thumbnail_url){current.thumbnail_url=meta.thumbnail_url;current.field_sources={...current.field_sources,thumbnail_url:'public WordPress featured image API'};}
     }}
    }catch{}
   }
   if(detailError){j.details_failed++;if(index>=0)c.items[index].detail_status=detailError.message;note(j,'Some individual details could not be read; source listing values were preserved.');}
   j.details_checked++;j.message='Collected '+c.items.length+' videos. Reading details '+j.details_checked+'/'+(j.details_checked+j.queue.length)+'...';
   if(!j.queue.length)finish(j,c);
  }
 }catch(e){j.status=c.items.length?'partial':'failed';j.message=e.message;j.coverage='source request incomplete';note(j,e.message);}
 return persist(j,c);
}
