import * as cheerio from 'cheerio';
import {readPublic} from '../lib/network.mjs';
import {parseListing} from '../lib/extract.mjs';
const listing=await readPublic('https://www.tokyomotion.net/user/yua_xx/videos');const item=parseListing(listing.html,listing.url).items[0];const page=await readPublic(item.url),$=cheerio.load(page.html);
const candidates=[];for(const m of page.html.matchAll(/\b(?:var|let|const)\s+(\w*(?:date|added|upload|video_add)\w*)\s*=\s*([^;\n]{1,250})/gi)){const name=m[1],value=m[2];candidates.push({name,value:/^[\s"'\d:.,+\-TZ/a-z]+$/i.test(value)&&value.length<100?value:'[non-date expression]'});}
console.log('DATE_VARIABLES',JSON.stringify(candidates));const timestamps=[...new Set(page.html.match(/\b(?:19|20)\d{2}[-/]\d{2}[-/]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g)||[])];console.log('LITERAL_DATE_CANDIDATES',JSON.stringify(timestamps));console.log('PUBLIC_DATE_ELEMENTS',JSON.stringify($('time,[itemprop="uploadDate"],[itemprop="datePublished"],meta[property*="time"],meta[property*="date"]').map((_,n)=>({tag:n.tagName,datetime:$(n).attr('datetime'),content:$(n).attr('content'),text:$(n).text().trim().slice(0,80)})).get()));
