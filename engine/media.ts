import robotsParser from 'robots-parser';
import {publicUrl,resolvePublic,transport} from './network.ts';
import {ProviderError} from './errors.ts';
export const MAX_MEDIA_BYTES=16*1024*1024;
export function validateMp4(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=new TextDecoder('latin1');
  let offset=0,ftyp=false,moov=false,mdat=false;
  while(offset+8<=bytes.length){
    let size=view.getUint32(offset),header=8;const kind=text.decode(bytes.subarray(offset+4,offset+8));
    if(size===1){if(offset+16>bytes.length)break;const big=view.getBigUint64(offset+8);if(big>BigInt(bytes.length))break;size=Number(big);header=16;}
    if(size===0)size=bytes.length-offset;
    if(size<header||offset+size>bytes.length)throw new ProviderError('invalid_media','The source returned an incomplete MP4 file.',422);
    if(kind==='ftyp')ftyp=true;
    if(kind==='mdat'&&size>header)mdat=true;
    if(kind==='moov'){
      const metadata=text.decode(bytes.subarray(offset+header,offset+size));
      if(/encv|enca|pssh|sinf/.test(metadata))throw new ProviderError('protected_media','Protected media cannot be downloaded.',422);
      moov=metadata.includes('vide');
    }
    offset+=size;
  }
  if(offset!==bytes.length||!ftyp||!moov||!mdat)throw new ProviderError('invalid_media','The source is not a complete, unencrypted MP4 video.',422);
}
export async function mediaFile(raw:string,options:{fetcher?:typeof fetch;resolve?:(host:string)=>Promise<void>}={}){
  const fetcher=options.fetcher||fetch,resolve=options.resolve||resolvePublic,read=transport({fetcher,resolve});
  let url=publicUrl(raw);
  for(let hop=0;hop<5;hop++){
    await resolve(url.hostname);
    let robots='';try{robots=(await read(url.origin+'/robots.txt',{cache:false})).text;}catch(e){if(!(e instanceof ProviderError&&e.status===404))throw e;}
    if(robotsParser(url.origin+'/robots.txt',robots).isAllowed(url.href,'VideoScope')===false)throw new ProviderError('robots_denied','Source instructions disallow this file.',403);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
    try{
      const response=await fetcher(url.href,{redirect:'manual',signal:controller.signal,headers:{accept:'video/mp4','user-agent':'VideoScope/4.0 PublicMediaReader'}});
      if([301,302,303,307,308].includes(response.status)){
        await response.body?.cancel();const next=response.headers.get('location');if(!next)throw new ProviderError('bad_redirect','Empty media redirect.',502);url=publicUrl(new URL(next,url).href);continue;
      }
      if(response.status!==200){await response.body?.cancel();throw new ProviderError('media_unavailable',`Source file returned HTTP ${response.status}.`,422);}
      const type=response.headers.get('content-type')?.split(';')[0].trim();
      if(type!=='video/mp4'){await response.body?.cancel();throw new ProviderError('invalid_media','The source did not return an MP4 video.',422);}
      const length=Number(response.headers.get('content-length'));
      if(length>MAX_MEDIA_BYTES){await response.body?.cancel();throw new ProviderError('media_limit','Direct MP4 downloads are limited to 16 MB on this service.',422);}
      const reader=response.body?.getReader();if(!reader)throw new ProviderError('invalid_media','Empty media response.',422);
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_MEDIA_BYTES){await reader.cancel();throw new ProviderError('media_limit','Direct MP4 downloads are limited to 16 MB on this service.',422);}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(length&&length!==size)throw new ProviderError('invalid_media','The source file was truncated.',422);
      validateMp4(bytes);return {bytes,url:url.href};
    }finally{clearTimeout(timer);}
  }
  throw new ProviderError('redirect_limit','Too many media redirects.',422);
}
