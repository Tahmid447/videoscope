import {createHmac, randomUUID} from 'node:crypto';

declare const Netlify: {env: {get(key: string): string | undefined}};
export function mediaConfigured(){return !!(Netlify.env.get('VIDEOSCOPE_MEDIA_API')&&Netlify.env.get('VIDEOSCOPE_SECRET_KEY'))}
function base(){
 const raw=Netlify.env.get('VIDEOSCOPE_MEDIA_API');
 if(!raw)throw new Error('The media backend is not connected. Downloads have not been enabled on this deployment.');
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Invalid media-service configuration.');
 return u.origin;
}
export async function mediaCall(owner:string,path:string,method='GET',body?:unknown){
 if(!/^\/api\/(?:route|analyze|download|scans|collections|jobs)(?:[/?]|$)/.test(path)||path.includes('..'))throw new Error('Invalid media API operation.');
 const secret=Netlify.env.get('VIDEOSCOPE_SECRET_KEY');if(!secret)throw new Error('The media backend credential is not configured.');
 const payload=Buffer.from(JSON.stringify({kind:'session',owner,exp:Math.floor(Date.now()/1000)+120,nonce:randomUUID()})).toString('base64url');
 const token=payload+'.'+createHmac('sha256',secret).update(payload).digest('hex');
 const r=await fetch(base()+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});
 let data:any;try{data=await r.json()}catch{throw new Error('The media service returned an unreadable response. Saved results were not removed.')}
 if(!r.ok)throw new Error(data.error?.message||data.detail||'Media service failed ('+r.status+').');
 if(data.downloadPath){
  if(!/^\/api\/jobs\/[a-f0-9]{32}\/file\?ticket=/.test(data.downloadPath))throw new Error('Invalid download ticket response.');
  data.downloadUrl=base()+data.downloadPath;
 }
 return data;
}
export async function providerRoute(owner:string,url:string){
 // Existing native HTML/feed providers retain their working collection path.
 const u=new URL(url);
 if(/(^|\.)(tokyomotion\.net|osakamotion\.net)$/.test(u.hostname))return false;
 if(/\.(mp4|webm|m3u8|mpd)(?:$)/i.test(u.pathname))return true;
 if(!mediaConfigured()){
  if(/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/.test(u.hostname))throw new Error('This URL needs the provider backend, which is not connected on this deployment.');
  return false;
 }
 const r=await mediaCall(owner,'/api/route','POST',{url});return r.supported===true;
}
