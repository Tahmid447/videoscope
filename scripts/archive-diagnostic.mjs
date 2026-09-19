import * as cheerio from 'cheerio';
const urls=['https://streamtape.com/e/9jyMK70P1zCakY0','https://hgcloud.to/e/7v0eolfnrhc8','https://playmogo.com/e/synctejviq3b','https://voe.sx/e/k1yxmwfo1vcu'];
for(const u of urls){try{
 const r=await fetch(u,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml,*/*;q=0.8'},signal:AbortSignal.timeout(15000)});const html=await r.text(),$=cheerio.load(html);
 const metas=$('meta').map((_,n)=>({n:$(n).attr('property')||$(n).attr('name'),v:$(n).attr('content')})).get().filter(x=>/title|image|duration|view|play|video|date|rating/i.test(x.n||'')).map(x=>({n:x.n,len:String(x.v||'').length,v:/view|duration|rating|date/i.test(x.n||'')?String(x.v||'').slice(0,100):undefined})).slice(0,30);
 const viewTokens=(html.match(/.{0,60}(?:views?|plays?|view_count|play_count).{0,100}/gi)||[]).map(x=>x.replace(/https?:\/\/[^"'\s]+/g,'[url]')).slice(0,20);
 console.log('EMBED',new URL(r.url).hostname,r.status,r.headers.get('content-type'),html.length,JSON.stringify({metas,viewTokens,video:$('video').length,sources:$('video source').length}));
 }catch(e){console.log('EMBED_ERROR',new URL(u).hostname,e.message)}}
