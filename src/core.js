/* Pure, tested filtering and formatting. Missing values stay missing. */
(function(root){
'use strict';
function numeric(v){return typeof v==='number'&&Number.isFinite(v);}
function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function localDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;const[y,m,d]=value.split('-').map(Number);const dt=new Date(y,m-1,d);return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d?dt:null;}
function published(item){if(!item.published_at)return null;const d=item.published_precision==='day'?localDate(item.published_at.slice(0,10)):new Date(item.published_at);return d&&!Number.isNaN(d.getTime())?d:null;}
function boundaries(filters,now=new Date()){
 const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1),start=new Date(end);
 if(filters.period==='today'){start.setDate(end.getDate()-1);return [start,end];}
 if(['7','30','365'].includes(String(filters.period))){start.setDate(end.getDate()-Number(filters.period));return [start,end];}
 if(filters.period==='custom'){const a=localDate(filters.dateFrom),b=localDate(filters.dateTo);if(b)b.setDate(b.getDate()+1);return [a,b];}
 return [null,null];
}
function filterItems(items,f={},saved=new Set(),now=new Date()){
 const [start,end]=boundaries(f,now);
 const terms=String(f.query||'').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(x=>{
  const hay=[x.title,x.creator,x.source].join(' ').toLocaleLowerCase();
  if(terms.some(t=>!hay.includes(t)))return false;
  if(f.savedOnly&&!saved.has(x.id))return false;
  if(f.hdOnly&&x.is_hd!==true)return false;
  if(f.activity==='new'&&!x.new_since_scan)return false;
  for(const[key,field,mult]of[['minViews','views',1],['minLikes','likes',1],['minVotes','rating_count',1],['minDuration','duration_seconds',60]]){
   if(f[key]!==''&&f[key]!==undefined&&f[key]!==null){const n=Number(f[key])*mult;if(Number.isFinite(n)&&(!numeric(x[field])||x[field]<n))return false;}
  }
  if(f.maxDuration!==''&&f.maxDuration!==undefined&&f.maxDuration!==null){const n=Number(f.maxDuration)*60;if(Number.isFinite(n)&&(!numeric(x.duration_seconds)||x.duration_seconds>n))return false;}
  if(start||end){const d=published(x);if(!d||(start&&d<start)||(end&&d>=end))return false;}
  return true;
 });
}
function sortItems(items,sort='views_desc'){
 const mode={views_desc:['views',-1],likes_desc:['likes',-1],rating_desc:['rating',-1],published_desc:['published',-1],published_asc:['published',1],duration_desc:['duration_seconds',-1],duration_asc:['duration_seconds',1],title_asc:['title',1]}[sort]||['views',-1];
 const[key,dir]=mode;
 function value(x){if(key==='published')return published(x)?.getTime()??null;if(key==='title')return x.title||'';return numeric(x[key])?x[key]:null;}
 return [...items].sort((a,b)=>{
  const av=value(a),bv=value(b);if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;
  if(av===null&&bv===null)return String(a.id).localeCompare(String(b.id));
  if(key==='title')return av.localeCompare(bv,undefined,{numeric:true,sensitivity:'base'});
  if(key==='rating'){
   const as=`${a.rating_worst}:${a.rating_best}:${a.rating_label||''}`,bs=`${b.rating_worst}:${b.rating_best}:${b.rating_label||''}`;
   if(as!==bs)return as.localeCompare(bs);
  }
  return (av-bv)*dir||String(a.title||'').localeCompare(String(b.title||''));
 });
}
function compact(value){if(!numeric(value))return '\u2014';if(value<1000)return value.toLocaleString();return new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value);}
function timecode(value){if(!numeric(value))return '\u2014';const s=Math.max(0,Math.floor(value));return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function prettyDate(item){const d=published(item);if(!d)return 'Date unavailable';return (item.published_precision==='approximate'?'~ ':'')+d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}
function rating(item){if(!numeric(item.rating))return '\u2014';return item.rating_best===100&&item.rating_worst===0?`${item.rating}%`:`${item.rating}/${item.rating_best}`;}
function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function toCSV(items){const fields=['title','url','creator','source','views','likes','rating','rating_best','rating_worst','rating_label','rating_count','duration_seconds','published_at','published_precision','is_hd','fetched_at','found_on','extracted_by'];return '\ufeff'+[fields.map(csvCell).join(','),...items.map(x=>fields.map(k=>csvCell(x[k])).join(','))].join('\r\n');}
const api={numeric,escapeHTML,safeURL,localDate,published,boundaries,filterItems,sortItems,compact,timecode,prettyDate,rating,csvCell,toCSV};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VS=api;
})(typeof window!=='undefined'?window:globalThis);
