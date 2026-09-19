import * as cheerio from 'cheerio';
const r=await fetch('https://internetchicks.com/actress/lillian-phillips/feed/',{headers:{'user-agent':'Mozilla/5.0','accept':'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(20000)});
const xml=await r.text(),$=cheerio.load(xml,{xmlMode:true});
const it=$('item').first(), raw=it.find('content\\:encoded').text()||it.find('description').text(),h=cheerio.load(raw);
console.log('IFRAME_ATTRS',JSON.stringify(h('iframe').map((_,n)=>h(n).attr()).get()));
console.log('LINK_ATTRS',JSON.stringify(h('a[href]').map((_,n)=>({href:h(n).attr('href'),text:h(n).text().replace(/\\s+/g,' ').trim().slice(0,80)})).get().slice(0,30)));
console.log('MEDIA_TAGS',JSON.stringify(it.children().map((_,n)=>({name:n.name,attrs:$(n).attr(),text:$(n).text().slice(0,80)})).get().filter(x=>/media|enclosure|thumbnail/i.test(x.name))));
