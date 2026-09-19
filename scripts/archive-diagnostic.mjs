import * as cheerio from 'cheerio';
const r=await fetch('https://internetchicks.com/actress/lillian-phillips/feed/',{headers:{'user-agent':'Mozilla/5.0','accept':'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(20000)});
const xml=await r.text(),$=cheerio.load(xml,{xmlMode:true}),raw=$('item').first().find('content\\:encoded').text(),h=cheerio.load(raw);
const nodes=h('*').map((_,n)=>({tag:n.tagName,id:h(n).attr('id'),cls:h(n).attr('class'),attrs:Object.fromEntries(Object.entries(h(n).attr()||{}).filter(([k])=>/^data-|src$|href$|poster|type|name$/.test(k)))})).get();
console.log('STRUCTURE',JSON.stringify(nodes.slice(0,120)));
console.log('VIEW_TOKENS',JSON.stringify((raw.match(/.{0,60}(?:views?|plays?|counter|post-views).{0,100}/gi)||[]).slice(0,20)));
