import * as cheerio from 'cheerio';
for(const u of ['https://internetchicks.com/actress/lillian-phillips/feed/','https://internetchicks.com/actress/lillian-phillips/feed/?paged=2','https://internetchicks.com/actress/lillian-phillips/feed/?paged=3','https://internetchicks.com/actress/lillian-phillips/feed/?paged=4']){
 const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0','accept':'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(20000)}); const xml=await r.text(),$=cheerio.load(xml,{xmlMode:true});
 console.log('PAGE',u,r.status,$('item').length,$('item title').first().text().slice(0,80),$('item title').last().text().slice(0,80));
}
