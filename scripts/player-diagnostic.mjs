import * as cheerio from 'cheerio';
import {readPublic,readRobots,allowedByRobots} from '../lib/network.mjs';
import {parseFeed,parsePlayerMeta} from '../lib/extract.mjs';
const feed=await readPublic('https://internetchicks.com/actress/lillian-phillips/feed/',{html:false});
const parsed=parseFeed(feed.html,feed.url),p=parsed.items[0]?.players?.[0]?.url;
console.log('FIRST_PLAYER',p);
try{
 const x=await readPublic(p), meta=parsePlayerMeta(x.html,x.url),$=cheerio.load(x.html);
 console.log('READPUBLIC_PLAYER',JSON.stringify({status:x.status,bytes:x.html.length,host:new URL(x.url).hostname,ogImage:$('meta[property="og:image"]').attr('content')||null,meta}));
}catch(e){console.log('READPUBLIC_ERROR',JSON.stringify({message:e.message,status:e.status||null}))}

const rr=await readRobots(p);console.log('PLAYER_ROBOTS',JSON.stringify({warning:rr.warning||null,bytes:rr.text.length,allowed:allowedByRobots(rr,p),sample:rr.text.slice(0,500)}));
