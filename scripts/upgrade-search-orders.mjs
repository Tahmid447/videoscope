import {readFileSync,writeFileSync} from 'node:fs';
const path='lib/scan-engine.mjs';let s=readFileSync(path,'utf8');
if(!s.includes("from './search-orders.mjs'")){
 const swaps=[
 ["import {createHash} from 'node:crypto';","import {createHash} from 'node:crypto';\nimport {rememberOrders,nextOrderOrGap} from './search-orders.mjs';"],
 ['function advance(j){j.next_url=j.pending_pages.shift()||null;}','function advance(j){j.next_url=j.pending_pages.shift()||null;nextOrderOrGap(j);}'],
 ['const advertised=feed?[result.next].filter(Boolean):advertisedPages(fetched.html,fetched.url);','if(!feed)rememberOrders(j,fetched.html,fetched.url);\n    const advertised=feed?[result.next].filter(Boolean):advertisedPages(fetched.html,fetched.url);'],
 ["advance(j);j.message='Read '","j.items=c.items.length;advance(j);j.message='Read '"]
 ];
 for(const [a,b] of swaps){if(!s.includes(a))throw new Error('Missing search integration anchor: '+a);s=s.replace(a,b)}
 writeFileSync(path,s);
}
