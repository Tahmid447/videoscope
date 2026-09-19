import * as cheerio from 'cheerio';
import {readPublic,readRobots,allowedByRobots} from '../lib/network.mjs';

const feedUrl='https://internetchicks.com/actress/lillian-phillips/feed/';
const feed=await readPublic(feedUrl,{html:false,limit:4_000_000,timeout:20000});
const $=cheerio.load(feed.html,{xmlMode:true});
const items=$('item').slice(0,3).toArray();
console.log('FEED',JSON.stringify({status:feed.status,bytes:feed.html.length,items:$('item').length}));
for(const [i,n] of items.entries()){
 const node=$(n),link=node.find('link').first().text().trim(),title=node.find('title').first().text().trim();
 const raw=node.find('content\\:encoded').first().text()||node.find('description').first().text()||'';
 const h=cheerio.load(raw);
 const imgs=h('img').map((_,x)=>({attrs:Object.keys(h(x).attr()||{}),src:h(x).attr('src')||null,dataSrc:h(x).attr('data-src')||null,lazy:h(x).attr('data-lazy-src')||null,srcset:h(x).attr('srcset')||h(x).attr('data-srcset')||null})).get().slice(0,8);
 const childNames=[...new Set(node.children().map((_,x)=>String(x.name||'')).get())];
 console.log('ITEM',i,JSON.stringify({path:new URL(link).pathname,childNames,htmlBytes:raw.length,imgs}));
 const origin=new URL(link).origin,slug=new URL(link).pathname.split('/').filter(Boolean).pop();
 const endpoints=[
  origin+'/wp-json/wp/v2/posts?slug='+encodeURIComponent(slug)+'&_embed=wp:featuredmedia',
  origin+'/?rest_route='+encodeURIComponent('/wp/v2/posts')+'&slug='+encodeURIComponent(slug)+'&_embed=wp:featuredmedia',
  origin+'/wp-json/oembed/1.0/embed?url='+encodeURIComponent(link),
  origin+'/wp-json/wp/v2/search?search='+encodeURIComponent(title)+'&per_page=3&type=post'
 ];
 for(const url of endpoints){
  try{
   const rr=await readRobots(url),allowed=allowedByRobots(rr,url);
   if(!allowed){console.log('ENDPOINT',JSON.stringify({path:new URL(url).pathname,query:new URL(url).searchParams.has('rest_route')?'rest_route':new URL(url).pathname.includes('oembed')?'oembed':new URL(url).pathname.includes('search')?'search':'posts',allowed:false}));continue}
   const x=await readPublic(url,{html:false,limit:2_000_000,timeout:15000});
   let data;try{data=JSON.parse(x.html)}catch{data=null}
   const first=Array.isArray(data)?data[0]:data;
   const media=first?._embedded?.['wp:featuredmedia']?.[0];
   const images=[];
   for(const v of [media?.source_url,media?.media_details?.sizes?.thumbnail?.source_url,media?.media_details?.sizes?.medium?.source_url,media?.media_details?.sizes?.large?.source_url,first?.thumbnail_url])if(v)images.push(v);
   console.log('ENDPOINT',JSON.stringify({path:new URL(url).pathname,kind:new URL(url).searchParams.has('rest_route')?'rest_route':new URL(url).pathname.includes('oembed')?'oembed':new URL(url).pathname.includes('search')?'search':'posts',allowed:true,status:x.status,bytes:x.html.length,json:Array.isArray(data)?'array':typeof data,count:Array.isArray(data)?data.length:null,id:first?.id||null,featured_media:first?.featured_media||null,images:[...new Set(images)].slice(0,6).map(v=>{try{const u=new URL(v);return {host:u.hostname,path:u.pathname}}catch{return {raw:String(v).slice(0,80)}}})}));
  }catch(e){console.log('ENDPOINT_ERROR',JSON.stringify({path:new URL(url).pathname,message:e.message,status:e.status||null}))}
 }
}
