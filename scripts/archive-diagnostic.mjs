import * as cheerio from 'cheerio';
import {readPublic} from '../lib/network.mjs';
const x=await readPublic('https://internetchicks.com/actress/lillian-phillips/feed/',{html:false});
const $=cheerio.load(x.html,{xmlMode:true});
const names=[...new Set($('*').map((_,n)=>String(n.name||'')).get())].filter(n=>/view|count|stat|play|rating|like/i.test(n));
const attrs=[];$('*').each((_,n)=>{for(const [k,v] of Object.entries($(n).attr()||{}))if(/view|count|stat|play|rating|like/i.test(k+' '+v))attrs.push({tag:n.name,k,v:String(v).slice(0,120)})});
const textMatches=(x.html.match(/.{0,80}(?:views?|plays?|ratings?|likes?|view_count|post_views).{0,80}/gi)||[]).slice(0,50);
console.log('FEED_METRICS',JSON.stringify({status:x.status,bytes:x.html.length,names,attrs:attrs.slice(0,50),textMatches}));
