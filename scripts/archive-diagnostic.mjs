import * as cheerio from 'cheerio';
const ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const r=await fetch('https://internetchicks.com/actress/lillian-phillips/feed/',{headers:{'user-agent':ua,'accept':'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(20000)});
const xml=await r.text(),$=cheerio.load(xml,{xmlMode:true});
console.log('FEED',r.status,'items',$('item').length,'bytes',xml.length);
$('item').slice(0,3).each((i,n)=>{
 const it=$(n), content=it.find('content\\:encoded').text()||it.find('description').text(),h=cheerio.load(content);
 const iframes=h('iframe[src]').map((_,x)=>h(x).attr('src')).get();
 const videos=h('video[src],video source[src]').map((_,x)=>h(x).attr('src')).get();
 const images=h('img[src]').map((_,x)=>h(x).attr('src')).get();
 console.log('ITEM',i,JSON.stringify({title:it.find('title').text().slice(0,120),link:it.find('link').text(),date:it.find('pubDate').text(),creator:it.find('dc\\:creator').text(),categories:it.find('category').map((_,x)=>$(x).text()).get().slice(0,10),iframes,videoCount:videos.length,imageCount:images.length,contentLength:content.length}));
});
