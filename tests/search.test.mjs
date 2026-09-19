import test from 'node:test';
import assert from 'node:assert/strict';
import {parseListing} from '../lib/extract.mjs';
import {makeJob,scanStep,resumeJob,advertisedPages} from '../lib/scanner.mjs';
const source='https://example.com/search?search_query=learning&search_type=videos';
const robots=async()=>({origin:'https://example.com',text:''});
const card=id=>`<div class="well well-sm"><a href="/video/${id}/source-title" class="thumb-popu"><div class="thumb-overlay"><img src="https://cdn.example.com/${id}.jpg" alt="Original ${id}"><div class="duration">02:50</div></div><span class="video-title">Original ${id}</span></a><div class="video-added">9 hours ago</div><div class="video-views">1,000 views</div><div class="video-rating"><b>50%</b></div></div>`;
function pageHTML(page,total=1146){
 const last=Math.ceil(total/20),first=(page-1)*20+1,end=Math.min(total,page*20);
 const links=[page+1,page+2,last].filter(p=>p>page&&p<=last).map(p=>`<a href="${source}&page=${p}">${p}</a>`).join('');
 return `<div class="well well-sm">Search results. Showing ${first} to ${end} of ${total} videos.</div>`+Array.from({length:Math.max(0,end-first+1)},(_,i)=>card(first+i)).join('')+`<nav class="pagination">${links}</nav>`;
}
const pageOf=url=>Number(new URL(url).searchParams.get('page')||1);
async function complete(j,c,read,limit=250){for(let i=0;i<limit&&!['complete','partial','failed','stopped'].includes(j.status);i++)await scanStep(j,c,read,robots);}
test('search cards with no video_id attribute preserve original metadata',()=>{
 const p=parseListing('<nav><a href="/login">Login</a></nav>'+pageHTML(1),source);
 assert.equal(p.items.length,20);assert.equal(p.expected,1146);
 const v=p.items[0];assert.equal(v.title,'Original 1');assert.equal(v.views,1000);assert.equal(v.rating,50);assert.equal(v.duration_seconds,170);assert.equal(v.date_raw,'9 hours ago');assert.equal(v.thumbnail_url,'https://cdn.example.com/1.jpg');
});
test('summary well and menu links never become video records',()=>{const p=parseListing('<div class="well well-sm">Showing 1 to 20 of 1146 videos.</div><nav><div class="well well-sm"><a href="/video/1/x"><span class="video-title">Menu link</span></a></div></nav>',source);assert.equal(p.items.length,0);});
test('all mode collects 1,146 unique videos over 58 pages',async()=>{
 const j=makeJob(source,'all',false),c={items:[],input:source};
 await complete(j,c,async url=>({url,html:pageHTML(pageOf(url))}));
 assert.equal(j.status,'complete');assert.equal(j.pages,58);assert.equal(c.items.length,1146);assert.equal(new Set(c.items.map(x=>x.id)).size,1146);assert.equal(j.coverage,'source count matched');
});
test('numeric page budget is partial and continue retains all existing results',async()=>{
 const j=makeJob(source,25,false),c={items:[],input:source},read=async url=>({url,html:pageHTML(pageOf(url))});
 await complete(j,c,read);assert.equal(j.status,'partial');assert.equal(c.items.length,500);assert.equal(j.can_resume,true);
 resumeJob(j);await complete(j,c,read);assert.equal(j.status,'complete');assert.equal(c.items.length,1146);assert.equal(new Set(c.items.map(x=>x.id)).size,1146);
});
test('a transient empty page is retried instead of ending the collection',async()=>{
 const j=makeJob(source,'all',false),c={items:[]};let attempts=0;
 const read=async url=>({url,html:pageOf(url)===18&&++attempts<=2?'<p>No Videos Found.</p>':pageHTML(pageOf(url))});
 await complete(j,c,read);assert.equal(j.status,'complete');assert.equal(c.items.length,1146);assert.equal(j.page_gaps.length,0);
});
test('an unavailable middle page does not hide later advertised pages; gap can be retried',async()=>{
 const j=makeJob(source,'all',false),c={items:[]};let recover=false;
 const read=async url=>({url,html:pageOf(url)===18&&!recover?'<p>No Videos Found.</p>':pageHTML(pageOf(url))});
 await complete(j,c,read);assert.equal(j.status,'partial');assert.equal(c.items.length,1126);assert.ok(c.items.some(x=>x.title==='Original 1146'));assert.equal(j.page_gaps.length,1);
 recover=true;resumeJob(j);await complete(j,c,read);assert.equal(j.status,'complete');assert.equal(c.items.length,1146);
});
test('search fallback never changes the keyword by using an unrelated feed',async()=>{
 const j=makeJob(source,'all',false),c={items:[]},calls=[];
 await complete(j,c,async url=>{calls.push(url);return {url,html:'<p>No Videos Found.</p>'};});
 assert.equal(j.status,'failed');assert.ok(calls.every(u=>u===source));assert.equal(c.items.length,0);
});
test('pagination frontier rejects other domains and changed queries',()=>{
 const html=`<div class="pagination"><a href="${source}&page=2">2</a><a href="https://evil.example/search?search_query=learning&search_type=videos&page=3">3</a><a href="https://example.com/search?search_query=changed&search_type=videos&page=4">4</a></div>`;
 assert.deepEqual(advertisedPages(html,source),[source+'&page=2']);
});
