/* Read only source-published alternative orderings of the exact same search. */
import {load} from 'cheerio';
function scope(raw){const u=new URL(raw);for(const k of ['o','page','paged'])u.searchParams.delete(k);u.searchParams.sort();u.hash='';return u.href}
export function orderContext(raw){const u=new URL(raw);u.searchParams.delete('page');u.searchParams.delete('paged');if(u.searchParams.get('o')==='mr')u.searchParams.delete('o');u.searchParams.sort();u.hash='';return u.href}
export function sameCountScope(a,b){return scope(a)===scope(b)}
export function rememberOrders(j,html,base){
 if(j.scan_mode!=='all'||new URL(base).pathname!=='/search')return;
 j.search_root??=base;j.alternate_orders??=[];j.orders_seen??=[];j.discovery_count??=0;
 const here=orderContext(base);if(!j.orders_seen.includes(here))j.orders_seen.push(here);
 const $=load(html),links=[],priorities={mv:0,tr:1,md:2,tf:3,mr:4};
 $('a[href]').each((_,n)=>{
  const label=$(n).text().trim();if(!/^(Most Viewed|Most Recent|Most Commented|Top Rated|Top Favorites)$/i.test(label))return;
  try{
   const u=new URL($(n).attr('href'),base),o=u.searchParams.get('o');
   // Preserve keyword, visibility, period and every other filter. A Public or
   // Private button is a different result set, not another ordering.
   if(scope(u.href)!==scope(j.search_root)||!(o in priorities))return;
   const key=orderContext(u.href);if(j.orders_seen.includes(key)||j.alternate_orders.includes(key))return;
   links.push({key,priority:priorities[o]});
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
