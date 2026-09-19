import {readFileSync,writeFileSync} from 'node:fs';
const path='lib/scan-engine.mjs';let s=readFileSync(path,'utf8');
function replace(a,b){if(s.includes(b))return;if(!s.includes(a))throw new Error('Missing search integration anchor: '+a);s=s.replace(a,b)}
if(!s.includes("from './search-orders.mjs'"))replace("import {createHash} from 'node:crypto';","import {createHash} from 'node:crypto';\nimport {rememberOrders,nextOrderOrGap,orderContext,sameCountScope} from './search-orders.mjs';");
else s=s.replace('import {rememberOrders,nextOrderOrGap}', 'import {rememberOrders,nextOrderOrGap,orderContext,sameCountScope}');
replace('function advance(j){j.next_url=j.pending_pages.shift()||null;}','function advance(j){j.next_url=j.pending_pages.shift()||null;nextOrderOrGap(j);}');
replace('const advertised=feed?[result.next].filter(Boolean):advertisedPages(fetched.html,fetched.url);','if(!feed)rememberOrders(j,fetched.html,fetched.url);\n    const advertised=feed?[result.next].filter(Boolean):advertisedPages(fetched.html,fetched.url);');
replace("advance(j);j.message='Read '","j.items=c.items.length;advance(j);j.message='Read '");
replace('if(Number.isFinite(result.expected)){','if(Number.isFinite(result.expected)&&(!j.search_root||sameCountScope(fetched.url,j.search_root))){');
replace("createHash('sha256').update(result.items.map(x=>x.id).sort().join('|'))","createHash('sha256').update(orderContext(target)+'|'+result.items.map(x=>x.id).sort().join('|'))");
replace("if(j.page_gaps.length)return 'some source pages unavailable';","if(j.expected!==null&&c.items.length===j.expected)return 'source count matched';\n if(j.page_gaps.length)return 'some source pages unavailable';");
writeFileSync(path,s);
