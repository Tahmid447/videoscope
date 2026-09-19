import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const STORE='videoscope-workspace';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/153 Safari/537.36 VideoScope/3.2';
const MAX_BYTES=5_000_000;
type Item=Record<string,any>;
type Collection={id:string,input:string,label:string,item_count:number,items:Item[],pages:number,created_at:string,updated_at:string,provider?:string};
type Job={id:string,collection_id:string,next_url:string|null,remaining:number,pages:number,items:number,status:string,message:string};

const store=()=>getStore(STORE,{consistency:'strong'});
const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const error=(m:string,status=400)=>json({detail:m},status);
const id=(p:string)=>p+'_'+crypto.randomBytes(8).toString('hex');
const now=()=>new Date().toISOString();
async function get<T>(key:string){return await store().get(key,{type:'json'}) as T|null}
async function set(key:string,value:any){await store().setJSON(key,value)}
function absolute(v:string,base:string){try{return new URL(v,base).href}catch{return ''}}
function compact(s:string){const m=s.replace(/,/g,'').match(/([\d.]+)\s*([kmb])?/i);if(!m)return null;let n=Number(m[1]);if(!Number.isFinite(n))return null;const u=(m[2]||'').toLowerCase();if(u==='k')n*=1e3;if(u==='m')n*=1e6;if(u==='b')n*=1e9;return Math.round(n)}
function duration(s:string){const m=s.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]):null}
function published(text:string){if(!text)return null;const d=new Date(text);return Number.isNaN(d.getTime())?null:d.toISOString()}
function privateIp(ip:string){if(net.isIPv4(ip)){const p=ip.split('.').map(Number);return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)}if(net.isIPv6(ip)){const s=ip.toLowerCase();return s==='::1'||s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe80:')}return true}
async function validate(raw:string){let u:URL;try{u=new URL(raw)}catch{throw new Error('Paste a valid public URL.')}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Only public http/https URLs are supported.');if(u.hostname==='localhost'||u.hostname.endsWith('.local'))throw new Error('Local network URLs are not supported.');const found=await dns.lookup(u.hostname,{all:true});if(!found.length||found.some(x=>privateIp(x.address)))throw new Error('Private or unresolved network addresses are not supported.');return u.href}
async function fetchPage(raw:string){let url=await validate(raw);for(let redirect=0;redirect<4;redirect++){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),18000);let res:Response;try{res=await fetch(url,{redirect:'manual',signal:ac.signal,headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,*/*;q=0.8','accept-language':'en-US,en;q=0.8'}})}finally{clearTimeout(timer)}if([301,302,303,307,308].includes(res.status)){const loc=res.headers.get('location');if(!loc)throw new Error('The source redirected without a destination.');url=await validate(absolute(loc,url));continue}if(!res.ok)throw new Error('The source returned HTTP '+res.status+'.');const ct=res.headers.get('content-type')||'';if(!/html|xhtml/i.test(ct))throw new Error('The source did not return an HTML page.');const reader=res.body?.getReader();if(!reader)throw new Error('The source returned no readable body.');const chunks:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;if(value){total+=value.byteLength;if(total>MAX_BYTES){reader.cancel();throw new Error('The source page is larger than the scan limit.')}chunks.push(value)}}return {url,html:Buffer.concat(chunks.map(x=>Buffer.from(x))).toString('utf8')}}throw new Error('Too many redirects.')}
function parse(html:string,base:string){
 const $=cheerio.load(html),source=new URL(base).hostname.replace(/^www\./,''),items:Item[]=[],seen=new Set<string>();
 const push=(x:Item|null)=>{if(x&&!seen.has(x.url)){seen.add(x.url);items.push(x)}};
 $('script[type="application/ld+json"]').each((_,el)=>{try{const raw=JSON.parse($(el).text()),stack=Array.isArray(raw)?raw:[raw];while(stack.length){const x=stack.shift();if(!x||typeof x!=='object')continue;if(Array.isArray(x['@graph']))stack.push(...x['@graph']);const t=String(x['@type']||'').toLowerCase();if(!t.includes('videoobject'))continue;const url=absolute(x.url||x.contentUrl||x.embedUrl||'',base);if(!url)continue;push({id:crypto.createHash('sha1').update(url).digest('hex').slice(0,16),title:String(x.name||x.headline||'Video').slice(0,300),url,creator:x.author?.name||x.creator?.name||null,source,thumbnail_url:absolute(Array.isArray(x.thumbnailUrl)?x.thumbnailUrl[0]:x.thumbnailUrl||'',base)||null,views:Number(x.interactionStatistic?.userInteractionCount)||null,likes:null,rating:Number(x.aggregateRating?.ratingValue)||null,rating_count:Number(x.aggregateRating?.ratingCount)||null,duration_seconds:null,published_at:published(x.uploadDate||x.datePublished||''),fetched_at:now(),found_on:base,extracted_by:'VideoObject'})}}catch{}});
 const selectors=['article','.video','.video-item','.video-card','.thumb-block','.thumb','.item','.post','.entry','.media','li'];
 for(const sel of selectors)$(sel).each((_,node)=>{
   const root=$(node),a=root.find('a[href]').first();if(!a.length)return;const url=absolute(a.attr('href')||'',base);if(!url)return;
   const title=(root.find('h1,h2,h3,h4,.title,.video-title,.entry-title').first().text()||a.attr('title')||a.text()).replace(/\s+/g,' ').trim().slice(0,300);if(title.length<2)return;
   const text=root.text().replace(/\s+/g,' ').trim(),img=root.find('img').first(),thumb=img.attr('data-src')||img.attr('data-lazy-src')||img.attr('src')||'';
   const likely=/(video|watch|movie|clip|post|entry|thumb)/i.test((root.attr('class')||'')+' '+url)||!!thumb||/\bviews?\b|\blikes?\b|\d{1,2}:\d{2}/i.test(text);if(!likely)return;
   const views=(text.match(/([\d.,]+\s*[kmb]?)\s*views?\b/i)||[])[1],likes=(text.match(/([\d.,]+\s*[kmb]?)\s*likes?\b/i)||[])[1],rating=(text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%/)||[])[1];
   const dt=root.find('time').first().attr('datetime')||root.find('time').first().text()||'';
   push({id:crypto.createHash('sha1').update(url).digest('hex').slice(0,16),title,url,creator:null,source,thumbnail_url:thumb?absolute(thumb.split(/\s+/)[0],base):null,views:views?compact(views):null,likes:likes?compact(likes):null,rating:rating?Number(rating):null,duration_seconds:duration(text),published_at:published(dt),fetched_at:now(),found_on:base,extracted_by:'HTML card'});
 });
 let next:string|null=null;const n=$('a[rel="next"],a.next,.next a,.pagination a.next,.page-numbers.next').first();if(n.length)next=absolute(n.attr('href')||'',base);if(!next)$('a[href]').each((_,a)=>{if(next)return;const t=$(a).text().trim();if(/^(next|next page|older|›|»|→)$/i.test(t))next=absolute($(a).attr('href')||'',base)});
 return {items,next,title:($('h1').first().text()||$('title').text()||source).replace(/\s+/g,' ').trim().slice(0,180)};
}
async function collections(){const list=await store().list({prefix:'collection/'}),out:any[]=[];for(const b of list.blobs){const c=await get<Collection>(b.key);if(c)out.push({id:c.id,input:c.input,label:c.label,item_count:c.item_count,pages:c.pages,updated_at:c.updated_at,provider:c.provider})}return out.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))}

export default async(req:Request,_context:Context)=>{
 const u=new URL(req.url),parts=u.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);
 try{
  if(req.method==='GET'&&parts[0]==='config')return json({version:'3.2-github',hosted:true});
  if(req.method==='GET'&&parts[0]==='collections'&&parts.length===1)return json(await collections());
  if(parts[0]==='collections'&&parts[1]){const key='collection/'+parts[1];if(req.method==='GET'){const c=await get<Collection>(key);return c?json(c):error('Collection not found.',404)}if(req.method==='DELETE'){await store().delete(key);return json({ok:true})}}
  if(req.method==='POST'&&parts[0]==='scans'&&parts.length===1){const body=await req.json() as any,target=await validate(String(body.url||'')),cid=id('col'),jid=id('job');const c:Collection={id:cid,input:target,label:new URL(target).hostname,item_count:0,items:[],pages:0,created_at:now(),updated_at:now()};const job:Job={id:jid,collection_id:cid,next_url:target,remaining:Math.max(1,Math.min(25,Number(body.pages)||5)),pages:0,items:0,status:'queued',message:'Ready to scan.'};await set('collection/'+cid,c);await set('job/'+jid,job);return json(job,201)}
  if(parts[0]==='scans'&&parts[1]){const key='job/'+parts[1],job=await get<Job>(key);if(!job)return error('Scan job not found.',404);if(req.method==='GET'&&parts.length===2)return json(job);if(req.method==='POST'&&parts[2]==='step'){if(!job.next_url||job.remaining<=0||['complete','partial','failed'].includes(job.status))return json(job);let c=await get<Collection>('collection/'+job.collection_id);if(!c)return error('Collection not found.',404);try{job.status='running';job.message='Scanning page '+(job.pages+1)+'…';const fetched=await fetchPage(job.next_url),parsed=parse(fetched.html,fetched.url),map=new Map(c.items.map(x=>[x.url,x]));for(const item of parsed.items)map.set(item.url,{...map.get(item.url),...item});c.items=[...map.values()];c.item_count=c.items.length;c.pages+=1;c.updated_at=now();if(c.pages===1&&parsed.title)c.label=parsed.title;job.pages=c.pages;job.items=c.item_count;job.remaining-=1;job.next_url=job.remaining>0?parsed.next:null;if(!job.next_url||job.remaining<=0){job.status='complete';job.message='Scan complete: '+job.items+' videos across '+job.pages+' page'+(job.pages===1?'':'s')+'.'}else job.message='Page '+job.pages+' scanned. '+job.items+' videos collected.';await set('collection/'+c.id,c);await set(key,job);return json(job)}catch(e:any){job.status=job.items?'partial':'failed';job.message=e?.message||'The website could not be scanned.';await set(key,job);return json(job)}}}
  if(req.method==='POST'&&parts[0]==='import'){const body=await req.json() as any,content=String(body.content||'');if(content.length>MAX_BYTES)return error('Import is too large.',413);let items:Item[]=[],label='Imported collection';try{const j=JSON.parse(content);items=Array.isArray(j)?j:Array.isArray(j.items)?j.items:[];label=j.label||label}catch{const base=String(body.url||'https://import.invalid/'),parsed=parse(content,base);items=parsed.items;label=parsed.title||label}const cid=id('col'),c:Collection={id:cid,input:String(body.url||''),label,item_count:items.length,items,pages:1,created_at:now(),updated_at:now(),provider:'import'};await set('collection/'+cid,c);return json(c,201)}
  return error('API route not found.',404);
 }catch(e:any){return error(e?.message||'Unexpected server error.',500)}
}
export const config:Config={path:'/api/*'};
