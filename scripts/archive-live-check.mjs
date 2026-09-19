import assert from 'node:assert/strict';
import {makeJob,scanStep} from '../lib/scanner.mjs';
import {readPublic} from '../lib/network.mjs';
import {parseFeed,feedURL} from '../lib/extract.mjs';
const url='https://internetchicks.com/actress/lillian-phillips/';
const feed=feedURL(url),raw=await readPublic(feed,{html:false}),direct=parseFeed(raw.html,raw.url);
console.log('DIRECT_FEED_CHECK',JSON.stringify({status:raw.status,type:raw.contentType,bytes:raw.html.length,items:direct.items.length,next:direct.next,first:direct.items[0]&&{title:direct.items[0].title,date:direct.items[0].published_at,players:direct.items[0].players?.length}}));
assert.ok(direct.items.length>=8,'public feed should expose video entries');
let job=makeJob(url,4,false),collection={id:'test',input:url,label:'',items:[],pages:0};
for(let i=0;i<8&&!['complete','partial','failed'].includes(job.status);i++){const out=await scanStep(job,collection);job=out.job;collection=out.c;console.log('SCAN_STEP',i+1,JSON.stringify({status:job.status,stage:job.stage,pages:job.pages,items:collection.items.length,next:job.next_url,warnings:job.warnings}))}
console.log('ARCHIVE_LIVE_RESULT',JSON.stringify({status:job.status,pages:job.pages,items:collection.items.length,coverage:job.coverage,warnings:job.warnings,first:collection.items[0]&&{title:collection.items[0].title,date:collection.items[0].published_at,precision:collection.items[0].date_precision,source:collection.items[0].source,players:collection.items[0].players?.length}}));
assert.ok(collection.items.length>=30,'expected public feed fallback to collect at least 30 video entries');
assert.ok(collection.items.every(x=>x.title&&x.url),'every feed record needs a real title and URL');
assert.ok(collection.items.some(x=>x.published_at),'feed publication dates should be preserved');
assert.ok(job.warnings.some(x=>/RSS\/Atom feed/.test(x)),'scan should disclose fallback source');
