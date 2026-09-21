import {createHash} from 'node:crypto';
import {mediaFile} from '../media.ts';
import {record,type Provider} from '../model.ts';
export const direct:Provider={
  id:'direct-mp4',
  detect:url=>/\.mp4$/i.test(url.pathname)?{provider:'direct-mp4',url:url.href,sourceType:'video'}:null,
  capabilities:()=>({id:'direct-mp4',name:'Direct MP4 file',sourceTypes:['video'],metrics:['title'],enumeration:true,credential:null,configured:true,download:'conditional',note:'Public, unencrypted MP4 files up to 16 MB. Files are validated and served as attachments. Streaming manifests and platform video pages require a separate media service.',delayMs:1000,cacheTtlSeconds:3600,enrichmentBatch:0}),
  async enumerate(source){
    await mediaFile(source.url);
    const filename=new URL(source.url).pathname.split('/').pop()||'video.mp4';let title=filename;try{title=decodeURIComponent(filename);}catch{/* Keep the source filename. */}
    const item=record('direct-mp4',createHash('sha256').update(source.url).digest('hex'),source.url,{title,downloadCapability:'direct-mp4',metadataSources:{title:'source filename',download:'Validated public MP4 container, video track and MIME; 16 MB maximum'}});
    return {items:[item],nextCursor:null,complete:true,expectedCount:1,label:title};
  },
};
