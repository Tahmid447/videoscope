import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {makeJob,scanStep} from '../lib/scanner.mjs';
import {parseListing} from '../lib/extract.mjs';
import {readPublic} from '../lib/network.mjs';
const source='https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos';
const j=makeJob(source,'all',false),c={items:[],input:source},rawIds=new Set(),pageRecords=new Map();
let requests=0;
async function auditedRead(url,opts){
 const f=await readPublic(url,opts);requests++;
 if(new URL(url).pathname==='/search'){
  const $=load(f.html),roots=$('.well.well-sm').filter((_,n)=>$(n).find('.video-title').length),ids=new Set();
  roots.each((_,n)=>{const r=$(n),a=r.find('a[href]').filter((_,a)=>{try{return /^\/video\/\d+(?:\/|$)/.test(new URL($(a).attr('href'),f.url).pathname)}catch{return false}}).first();if(!a.length)return;const id=new URL(a.attr('href'),f.url).pathname.match(/^\/video\/(\d+)/)[1];ids.add(id);rawIds.add(id);});
  const parsed=parseListing(f.html,f.url);
  const parsedIds=new Set(parsed.items.map(x=>new URL(x.url).pathname.match(/^\/video\/(\d+)/)?.[1]).filter(Boolean));
  assert.deepEqual([...parsedIds].sort(),[...ids].sort(),'Parser must match original search cards, not navigation.');
  for(const item of parsed.items){assert.ok(item.title);assert.ok(item.thumbnail_url);assert.equal(typeof item.views,'number');assert.ok(item.date_raw);}
  const p=Number(new URL(url).searchParams.get('page')||1);pageRecords.set(p,{page:p,original_cards:ids.size,parsed:parsed.items.length,expected:parsed.expected});
  if(p===1){const filters=$('a[href]').filter((_,a)=>/^(all|public|private|most viewed|most recent)$/i.test($(a).text().trim())).map((_,a)=>({label:$(a).text().trim(),href:$(a).attr('href')})).get();console.log('SOURCE_FILTER_LINKS',JSON.stringify(filters));}
 }
 return f;
}
for(let steps=0;steps<1500&&!['complete','partial','failed','stopped'].includes(j.status);steps++){
 await scanStep(j,c,auditedRead);
 if(steps%10===0||['complete','partial','failed'].includes(j.status))console.log('SEARCH_PROGRESS',JSON.stringify({status:j.status,pages:j.pages,items:c.items.length,reported:j.expected,gaps:j.page_gaps.length,next:!!j.next_url}));
 if(!['complete','partial','failed','stopped'].includes(j.status))await new Promise(r=>setTimeout(r,Math.max(1000,j.retry_after_ms||0)));
}
assert.ok(c.items.length>0,'The search parser must return actual source videos.');
assert.equal(c.items.length,rawIds.size,'Every observed public video identity must be retained exactly once.');
assert.equal(new Set(c.items.map(x=>x.id)).size,c.items.length);
assert.equal(j.pending_pages.length,0,'All advertised pages must be attempted.');
if(c.items.length!==j.expected)assert.notEqual(j.status,'complete','An unresolved total mismatch must never be marked complete.');
const report={source,tested_at:new Date().toISOString(),status:j.status,source_reported:j.expected,collected:c.items.length,pages_read:j.pages,requests,pages:[...pageRecords.values()].sort((a,b)=>a.page-b.page),gaps:j.page_gaps.map(x=>({page:x.page,reason:x.reason})),coverage:j.coverage,metadata:c.metadata_coverage,all_observed_source_ids_retained:c.items.length===rawIds.size,remaining_advertised_pages:j.pending_pages.length,scope:'public listing metadata; video/media bodies not requested'};
await mkdir('artifacts-search',{recursive:true});await writeFile('artifacts-search/source-verification.json',JSON.stringify(report,null,2));
console.log('SEARCH_SOURCE_VERIFIED',JSON.stringify(report));
