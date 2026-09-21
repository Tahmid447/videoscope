import test from 'node:test';
import assert from 'node:assert/strict';
import {client,validateCompletion} from '../scripts/hosted-v4-client.mjs';

test('hosted reads survive DNS failures and Retry-After; uncertain creates are not replayed',async()=>{
 let calls=0;const waits=[];
 const api=client('https://preview.example.com','test-workspace',{sleep:async ms=>waits.push(ms),fetcher:async()=>{calls++;if(calls===1)throw new TypeError('fetch failed');if(calls===2)return new Response('{}',{status:429,headers:{'retry-after':'3'}});return Response.json({status:'complete'});}});
 assert.equal((await api('scans/id')).status,'complete');assert.equal(calls,3);assert.deepEqual(waits,[1000,3000]);
 calls=0;
 const create=client('https://preview.example.com','test-workspace',{sleep:async()=>{},fetcher:async()=>{calls++;throw new TypeError('response lost');}});
 await assert.rejects(create('scans',{url:'https://example.com/videos'}),/response lost/);assert.equal(calls,1);
 const denied=client('https://preview.example.com','test-workspace',{fetcher:async()=>Response.json({detail:'denied'},{status:403}),sleep:async()=>{throw new Error('must not retry');}});
 await assert.rejects(denied('scans/id'),/denied/);
 let bodies=0;
 const interruptedBody=client('https://preview.example.com','test-workspace',{sleep:async()=>{},fetcher:async()=>{bodies++;return bodies===1?new Response('{broken'):Response.json({saved:true});}});
 assert.equal((await interruptedBody('scans/id')).saved,true);assert.equal(bodies,2);
});
test('hosted completion accepts honest source exhaustion but rejects interrupted or unresolved scans',()=>{
 const partial={status:'partial',phase:'enriching',nextCursor:null,currentCursor:{},pagesRead:252,expectedCount:1150,uniqueItemsCollected:1145,complete:false,warnings:['1145 / 1150 reported items publicly reached. Partial coverage.'],errors:[],diagnostics:[{result:'reachable pagination exhausted'}]};
 validateCompletion('tokyomotion-search',partial);
 assert.throws(()=>validateCompletion('youtube',partial));
 assert.throws(()=>validateCompletion('tokyomotion-search',{...partial,enumerationInterrupted:true}));
 assert.throws(()=>validateCompletion('tokyomotion-search',{...partial,warnings:[...partial.warnings,'An advertised source page remained unreadable after bounded retries and a final recheck.']}));
 assert.throws(()=>validateCompletion('tokyomotion-search',{...partial,complete:true}));
 assert.throws(()=>validateCompletion('tokyomotion-search',{...partial,pagesRead:25}));
 assert.throws(()=>validateCompletion('tokyomotion-search',{...partial,nextCursor:{page:253}}));
});
