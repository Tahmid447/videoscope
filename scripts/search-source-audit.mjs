import * as cheerio from 'cheerio';
import {readPublic,readRobots,allowedByRobots} from '../lib/network.mjs';
import {nextPage} from '../lib/extract.mjs';
const start='https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos';
const rules=await readRobots(start),seen=new Set(),ids=new Set();let url=start,pages=0,expected=null,unlinked=0;
while(url&&pages<110){
 if(seen.has(url))throw new Error('Pagination loop');seen.add(url);if(!allowedByRobots(rules,url))throw new Error('Disallowed source read');
 const x=await readPublic(url),$=cheerio.load(x.html);const count=$('body').text().match(/Showing\s+[\d,]+\s+to\s+[\d,]+\s+of\s+([\d,]+)\s+videos/i);if(count)expected=Number(count[1].replace(/,/g,''));
 const links=$('a[href]').filter((_,n)=>{try{return /^\/video\/\d+(?:\/|$)/.test(new URL($(n).attr('href'),url).pathname)}catch{return false}});
 const pageIds=new Set(links.map((_,n)=>new URL($(n).attr('href'),url).pathname.match(/^\/video\/(\d+)/)[1]).get());for(const id of pageIds)ids.add(id);
 const blanks=$('.well.well-sm').filter((_,n)=>!$(n).find('a[href*="/video/"]').length);unlinked+=blanks.length;
 if(pages===0)console.log('UNLINKED',JSON.stringify(blanks.map((_,n)=>({classes:$(n).attr('class'),imageCount:$(n).find('img').length,imageId:$(n).find('img').attr('id'),links:$(n).find('a').map((_,a)=>({href:$(a).attr('href'),classes:$(a).attr('class')})).get(),private:!!$(n).find('.private-text-icon,.private-video,.locked').length,html:$.html($(n)).replace(/<img[^>]*>/g,'<img>').slice(0,1800)})).get()));
 pages++;url=nextPage($,x.url);if(pages%10===0||!url)console.log('AUDIT_PAGE',JSON.stringify({pages,unique:ids.size,onPage:pageIds.size,expected,next:!!url}));
 await new Promise(r=>setTimeout(r,220));
}
console.log('SEARCH_SOURCE_AUDIT',JSON.stringify({pages,unique:ids.size,expected,unlinked,exhausted:!url}));
