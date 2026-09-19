import * as cheerio from 'cheerio';
const ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
async function get(url, headers={}){
  const r=await fetch(url,{redirect:'follow',headers:{'user-agent':ua,'accept':'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5','accept-language':'en-US,en;q=0.9',...headers},signal:AbortSignal.timeout(20000)});
  const text=await r.text(); return {r,text,url:r.url};
}
function summarize(label,x){
 const $=cheerio.load(x.text);
 const links=$('article h2 a[href], article h3 a[href], .entry-title a[href]').map((_,n)=>new URL($(n).attr('href'),x.url).href).get();
 const classes=[...new Set($('[class]').map((_,n)=>String($(n).attr('class')).split(/\s+/)).get().flat().filter(s=>/view|video|play|post|entry/i.test(s)))].slice(0,100);
 const viewTexts=$('*').filter((_,n)=>/\b\d[\d,.]*\s*(?:views?|plays?)\b/i.test($(n).clone().children().remove().end().text())).map((_,n)=>$(n).clone().children().remove().end().text().replace(/\s+/g,' ').trim().slice(0,120)).get().slice(0,20);
 console.log(label,JSON.stringify({status:x.r.status,final:x.url,type:x.r.headers.get('content-type'),bytes:x.text.length,articles:$('article').length,links:links.length,times:$('time').length,images:$('article img').length,videos:$('video').length,sources:$('video source').length,iframes:$('iframe').length,viewTexts,classes}));
 return links[0];
}
const base='https://internetchicks.com/actress/lillian-phillips/';
const archive=await get(base); const first=summarize('ARCHIVE',archive);
for(const u of [new URL('feed/',base).href,'https://internetchicks.com/wp-json/wp/v2/search?search=Lillian%20Phillips&per_page=5']){
 try{const x=await get(u); summarize('ALT '+u,x)}catch(e){console.log('ALT_ERROR',u,e.message)}
}
if(first){
 try{
  const p=await get(first),$=cheerio.load(p.text); summarize('DETAIL',p);
  const metas=$('meta').map((_,n)=>({name:$(n).attr('property')||$(n).attr('name'),len:String($(n).attr('content')||'').length})).get().filter(x=>/video|date|view|image|title|duration|rating/i.test(x.name||'')).slice(0,60);
  const scripts=$('script[src]').map((_,n)=>new URL($(n).attr('src'),p.url).hostname+new URL($(n).attr('src'),p.url).pathname).get().filter(s=>/video|player|view|stat|count|embed|wp-content/i.test(s)).slice(0,50);
  const iframes=$('iframe[src]').map((_,n)=>{try{return new URL($(n).attr('src'),p.url).hostname}catch{return 'bad'}}).get();
  console.log('DETAIL_META',JSON.stringify({metas,scripts,iframes,hasJsonLd:$('script[type="application/ld+json"]').length,htmlHasView:/\bviews?\b/i.test(p.text),htmlHasPlayer:/videojs|jwplayer|plyr|fluidplayer|playerjs|<video/i.test(p.text)}));
 }catch(e){console.log('DETAIL_ERROR',e.message)}
}
