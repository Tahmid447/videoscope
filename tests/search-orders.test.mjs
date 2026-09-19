import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberOrders,orderContext,sameCountScope,nextOrderOrGap} from '../lib/search-orders.mjs';
const root='https://example.com/search?search_query=lesson&search_type=videos';
const link=(query,text)=>'<a href="'+root+query+'">'+text+'</a>';
test('alternate sorting never broadens visibility, keyword or time filters',()=>{
 const j={scan_mode:'all'};
 rememberOrders(j,link('&o=mv','Most Viewed')+link('&type=private&o=mv','Most Viewed')+link('&t=w&o=tr','Top Rated')+'<a href="https://example.com/search?search_query=other&search_type=videos&o=mv">Most Viewed</a>',root);
 assert.equal(j.alternate_orders.length,1);assert.equal(new URL(j.alternate_orders[0]).searchParams.get('o'),'mv');
 assert.equal(sameCountScope(root,root+'&type=private'),false);
});
test('default and explicit recent order share the same context, not a duplicate pass',()=>{
 assert.equal(orderContext(root),orderContext(root+'&o=mr&page=9'));
 const j={scan_mode:'all'};rememberOrders(j,link('&o=mr','Most Recent'),root);assert.equal(j.alternate_orders.length,0);
});
test('different sort orders have different duplicate-detection contexts',()=>{
 assert.notEqual(orderContext(root),orderContext(root+'&o=mv'));
 assert.equal(orderContext(root+'&o=mv'),orderContext(root+'&o=mv&page=17'));
});
test('only advertised sorts are queued, de-duplicated and prioritized',()=>{
 const j={scan_mode:'all'};rememberOrders(j,link('&o=tr','Top Rated')+link('&o=mv','Most Viewed')+link('&o=mv','Most Viewed'),root);
 assert.deepEqual(j.alternate_orders.map(x=>new URL(x).searchParams.get('o')),['mv','tr']);
});
test('matching the advertised total does not start an unnecessary additional pass',()=>{
 const j={scan_mode:'all',next_url:null,pages:60,page_limit:1000,expected:1146,items:1146,alternate_orders:[root+'&o=tr'],page_gaps:[]};
 nextOrderOrGap(j);assert.equal(j.next_url,null);
});
