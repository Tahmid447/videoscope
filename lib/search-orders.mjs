/* Enumerate only controls actually published by this same search page. */
import {load} from 'cheerio';
function scope(url,partitions){const u=new URL(url);for(const k of ['o','page','paged',...(partitions?['type']:[])])u.searchParams.delete(k);u.searchParams.sort();u.hash='';return u.href}
export function orderContext(url){const u=new URL(url);u.searchParams.delete('page');u.searchParams.delete('paged');if(u.searchParams.get('o')==='mr')u.searchParams.delete('o');u.searchParams.sort();u.hash='';return u.href}
export function sameCountScope(a,b){return new URL(a).searchParams.get('type')===new URL(b).searchParams.get('type')}
export function rememberOrders(j,html,base){
 if(j.scan_mode!=='all'||new URL(base).pathname!=='/search')return;
 j.search_root??=base;j.alternate_orders??=[];j.orders_seen??=[];j.discovery_count??=0;
 const root=new URL(j.search_root),partitions=!root.searchParams.has('type'),here=orderContext(base);
 if(!j.orders_seen.includes(here))j.orders_seen.push(here);
 const $=load(html),links=[];
 $('a[href]').each((_,n)=>{
  const label=$(n).text().trim();if(!/^(Most Viewed|Most Recent|Public|Private)$/i.test(label))return;
  try{const u=new URL($(n).attr('href'),base);if(scope(u.href,partitions)!==scope(j.search_root,partitions))return;
   const visibility=u.searchParams.get('type'),o=u.searchParams.get('o');
   if(o&&!['mr','mv'].includes(o))return;
   if(visibility&&!['public','private',root.searchParams.get('type')].includes(visibility))return;
   if(!partitions&&visibility!==root.searchParams.get('type'))return;
   const key=orderContext(u.href);if(j.orders_seen.includes(key)||j.alternate_orders.includes(key))return;
   links.push({key,priority:/^(Public|Private)$/i.test(label)?0:1});
  }catch{}
 });
 for(const {key} of links.sort((a,b)=>a.priority-b.priority))if(j.discovery_count<4&&!j.alternate_orders.includes(key)){j.alternate_orders.push(key);j.discovery_count++}
}
export function nextOrderOrGap(j){
 if(j.next_url||j.scan_mode!=='all'||j.pages>=j.page_limit)return;
 if(j.expected!==null&&j.items===j.expected)return;
 if(j.expected!==null&&j.items<j.expected&&j.alternate_orders?.length){j.next_url=j.alternate_orders.shift();j.alternate_passes=(j.alternate_passes||0)+1;return}
 if(j.page_gaps.length&&!j.gap_recheck_done){
  j.gap_recheck_done=true;const retry=j.page_gaps.map(x=>x.url);j.visited=j.visited.filter(u=>!retry.includes(u));j.page_gaps=[];for(const u of retry)delete j.attempts[u];j.pending_pages.push(...retry.filter(u=>!j.pending_pages.includes(u)));j.next_url=j.pending_pages.shift()||null;
 }
}
