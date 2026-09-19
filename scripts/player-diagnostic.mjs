import {readPublic,readRobots,allowedByRobots} from '../lib/network.mjs';
import {parseFeed,parsePlayerMeta} from '../lib/extract.mjs';
const feed=await readPublic('https://internetchicks.com/actress/lillian-phillips/feed/',{html:false});
const item=parseFeed(feed.html,feed.url).items[0];
for(const [i,p] of (item.players||[]).entries()){
 try{
  const rr=await readRobots(p.url),allowed=allowedByRobots(rr,p.url);
  if(!allowed){console.log('MIRROR',i,JSON.stringify({host:new URL(p.url).hostname,allowed:false,robots:rr.text.slice(0,180)}));continue}
  const x=await readPublic(p.url),meta=parsePlayerMeta(x.html,x.url);
  console.log('MIRROR',i,JSON.stringify({host:new URL(p.url).hostname,allowed:true,status:x.status,bytes:x.html.length,thumbnail:!!meta.thumbnail_url,views:meta.views,duration:meta.duration_seconds,title:meta.player_title}));
 }catch(e){console.log('MIRROR',i,JSON.stringify({host:new URL(p.url).hostname,error:e.message,status:e.status||null}))}
}
