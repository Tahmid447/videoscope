import { createHash } from 'node:crypto';
import { record, knownNumber, type VideoRecord } from './model.ts';
import { publicUrl } from './network.ts';
import { ProviderError } from './errors.ts';
export function importRecord(raw: Record<string, any>, owner: string): VideoRecord {
  const url=publicUrl(String(raw.canonicalUrl || raw.url || '')).href;
  if(!raw.title || typeof raw.title!=='string')throw new ProviderError('invalid_import','Every imported record needs a title and public URL.',400);
  const id=createHash('sha256').update(owner+'|'+url).digest('hex');
  const v=record('import',id,url,{title:raw.title.slice(0,600),description:typeof raw.description==='string'?raw.description.slice(0,12000):null,
    uploader:typeof (raw.uploader||raw.creator)==='string'?(raw.uploader||raw.creator).slice(0,150):null,
    thumbnailUrl:null,datePrecision:['day','timestamp','approximate'].includes(raw.datePrecision||raw.date_precision)?raw.datePrecision||raw.date_precision:'unavailable',
    relativePublishedText:typeof (raw.relativePublishedText||raw.date_raw)==='string'?(raw.relativePublishedText||raw.date_raw).slice(0,150):null,
    tags:Array.isArray(raw.tags)?raw.tags.slice(0,40).map((x:any)=>String(x).slice(0,120)):[],categories:Array.isArray(raw.categories)?raw.categories.slice(0,40).map((x:any)=>String(x).slice(0,120)):[],
    metadataSources:{listing:'user-imported metadata; not independently verified'},availability:'user import',enrichedAt:new Date().toISOString()});
  const thumbnail=raw.thumbnailUrl||raw.thumbnail_url;if(thumbnail)try{v.thumbnailUrl=publicUrl(String(thumbnail)).href;}catch{/* Invalid media links are omitted. */}
  const published=raw.publishedAt||raw.published_at;if(typeof published==='string'&&Number.isFinite(Date.parse(published)))v.publishedAt=new Date(published).toISOString();
  for(const [field,legacy] of Object.entries({views:'views',likes:'likes',dislikes:'dislikes',comments:'comments_count',rating:'rating',ratingCount:'rating_count',ratingScale:'rating_best',durationSeconds:'duration_seconds',width:'width',height:'height'})) (v as any)[field]=knownNumber(raw[field]??raw[legacy]);
  v.isHD=typeof (raw.isHD??raw.is_hd)==='boolean'?(raw.isHD??raw.is_hd):null;
  return v;
}
