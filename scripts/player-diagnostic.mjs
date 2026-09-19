import * as cheerio from 'cheerio';
const ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const get=async(url,accept='text/html,*/*;q=0.5')=>{const r=await fetch(url,{redirect:'follow',headers:{'user-agent':ua,'accept':accept,'accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});return {r,text:await r.text(),url:r.url}};
const feed=await get('https://internetchicks.com/actress/lillian-phillips/feed/','application/rss+xml,application/xml,text/xml,*/*;q=0.5');
const $=cheerio.load(feed.text,{xmlMode:true}), entries=[];
$('item').slice(0,3).each((i,n)=>{const it=$(n),raw=it.find('content\\:encoded').text()||it.find('description').text(),h=cheerio.load(raw);const players=[];h('[onclick]').each((_,x)=>{const m=String(h(x).attr('onclick')||'').match(/playEmbed\(\s*["']([^"']+)/i);if(m)players.push(m[1])});h('iframe[src],iframe[data-src],embed[src]').each((_,x)=>players.push(h(x).attr('data-src')||h(x).attr('src')));entries.push({title:it.find('title').text(),players:[...new Set(players)].filter(x=>x&&!/^about:blank/i.test(x))})});
for(const [i,e] of entries.entries()){
 console.log('ENTRY',i,JSON.stringify({title:e.title.slice(0,100),players:e.players.map(p=>{try{const u=new URL(p,'https://internetchicks.com/');return {host:u.hostname,path:u.pathname.slice(0,120),query:[...u.searchParams.keys()]}}catch{return {bad:true}}})}));
 for(const [j,p0] of e.players.slice(0,3).entries()){
  try{
   const p=new URL(p0,'https://internetchicks.com/').href, x=await get(p),h=cheerio.load(x.text);
   const body=h('body').text().replace(/\s+/g,' ').trim();
   const viewTexts=[...new Set((body.match(/.{0,45}\b\d[\d,.]*\s*(?:views?|plays?)\b.{0,45}/gi)||[]).slice(0,12))];
   const metas=h('meta').map((_,n)=>({n:h(n).attr('property')||h(n).attr('name'),v:String(h(n).attr('content')||'').slice(0,100)})).get().filter(x=>/video|view|play|duration|title|image/i.test(x.n||'')).slice(0,30);
   const sources=h('video[src],video source[src]').map((_,n)=>h(n).attr('src')).get().map(v=>{try{const u=new URL(v,x.url);return {host:u.hostname,ext:u.pathname.split('.').pop()?.slice(0,8)}}catch{return {bad:true}}}).slice(0,10);
   console.log('PLAYER',i,j,JSON.stringify({status:x.r.status,host:new URL(x.url).hostname,bytes:x.text.length,type:x.r.headers.get('content-type'),viewTexts,metas,sources,hasHls:/\.m3u8|application\/vnd\.apple\.mpegurl/i.test(x.text),hasMp4:/\.mp4(?:[?"'\\s]|$)/i.test(x.text)}));
  }catch(err){console.log('PLAYER_ERROR',i,j,String(err.message||err))}
 }
}
