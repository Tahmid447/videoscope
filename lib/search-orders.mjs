/* Only source-published sort links: same keyword, visibility and time filters. */
import {load} from 'cheerio';
function scope(url){const u=new URL(url);for(const k of ['o','page','paged'])u.searchParams.delete(k);u.searchParams.sort();u.hash='';return u.href}
function order(url){const u=new URL(url);u.searchParams.delete('page');u.searchParams.delete('paged');u.searchParams.sort();u.hash='';return u.href}
export function rememberOrders(j,html,base){
 if(j.scan_mode!=='all'||new URL(base).pathname!=='/search')return;
 j.alternate_orders??=[];j.orders_seen??=[];const here=order(base);
 if(!j.orders_seen.includes(here))j.orders_seen.push(here);
 const $=load(html);
 $('a[href]').each((_,n)=>{const label=$(n).text().trim();if(!/^(Most Viewed|Most Recent)$/i.test(label))return;
  try{const u=new URL($(n).attr('href'),base);if(!['mr','mv'].includes(u.searchParams.get('o'))||scope(u.href)!==scope(base))return;const key=order(u.href);if(j.orders_seen.includes(key)||j.alternate_orders.includes(key))return;
   // The absent ordering parameter is the source default (Most Recent).
   if(!new URL(base).searchParams.has('o')&&u.searchParams.get('o')==='mr')return;
   if(j.alternate_orders.length<2)j.alternate_orders.push(key);
  }catch{}
 });
}
export function nextOrderOrGap(j){
 if(j.next_url||j.scan_mode!=='all'||j.pages>=j.page_limit)return;
 const need=j.expected!==null&&j.items<j.expected;
 if(need&&j.alternate_orders?.length){j.next_url=j.alternate_orders.shift();j.alternate_passes=(j.alternate_passes||0)+1;return}
 if(j.page_gaps.length&&!j.gap_recheck_done){
  j.gap_recheck_done=true;const retry=j.page_gaps.map(x=>x.url);j.visited=j.visited.filter(u=>!retry.includes(u));j.page_gaps=[];for(const u of retry)delete j.attempts[u];j.pending_pages.push(...retry.filter(u=>!j.pending_pages.includes(u)));j.next_url=j.pending_pages.shift()||null;
 }
}
