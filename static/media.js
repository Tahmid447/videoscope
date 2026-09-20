/* All media bytes come from the VideoScope backend, never a source redirect. */
'use strict';
window.VideoScopeMedia=(()=>{
 let analysis=null,job=null,busy=false,source=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const el=id=>document.getElementById(id);
 const bytes=n=>typeof n==='number'?(n/1048576).toFixed(1)+' MB':'Size determined during retrieval';
 async function api(path,method='GET',body){
  const token=JSON.parse(localStorage.getItem('videoscope-workspace-v33')||'null');
  const r=await fetch('/api/media'+path,{method,headers:{'Content-Type':'application/json','x-videoscope-workspace':token||''},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  let d;try{d=await r.json()}catch{throw new Error('The media service returned an unreadable response.')}
  if(!r.ok)throw new Error(d.detail||d.error?.message||'Media request failed ('+r.status+').');return d;
 }
 function setup(){
  if(el('mediaDialog'))return;
  const d=document.createElement('dialog');d.id='mediaDialog';d.className='media-dialog';
  d.innerHTML='<button id="mediaClose" class="btn ghost media-close" aria-label="Close download panel">Close</button><h2>Download video</h2><p id="mediaTitle"></p><img id="mediaThumb" alt="Source video thumbnail" style="max-width:100%;max-height:220px;object-fit:contain" hidden><p id="mediaMetadata" class="fine-print"></p><p id="mediaMessage" role="status" aria-live="polite"></p><div id="mediaOptions" hidden><label>Quality and format<select id="mediaFormat"></select></label><label>Filename<input id="mediaFilename" maxlength="160" autocomplete="off"></label><small id="mediaSize"></small><div class="media-buttons"><button id="mediaPrepare" class="btn primary">Download video</button><button id="mediaCancel" class="btn ghost" hidden>Cancel preparation</button><button id="mediaSave" class="btn primary" hidden>Save video to device</button></div></div><progress id="mediaProgress" max="100" hidden></progress><p id="mediaValidation" class="fine-print"></p>';
  document.body.append(d);
  el('mediaClose').onclick=()=>d.close();
  el('mediaFormat').onchange=syncFormat;
  el('mediaPrepare').onclick=prepare;
  el('mediaSave').onclick=()=>save().catch(fail);
  el('mediaCancel').onclick=async()=>{try{if(job)await api('/jobs/'+job.jobId,'DELETE');el('mediaMessage').textContent='Preparation cancelled.'}catch(e){fail(e)}};
 }
 function fail(error){el('mediaMessage').textContent=error.message||'The download could not be completed.';el('mediaMessage').classList.add('media-error')}
 function syncFormat(){
  const f=analysis?.formats.find(f=>f.id===el('mediaFormat').value);if(!f)return;
  const name=el('mediaFilename').value||analysis.title||'Video';
  el('mediaFilename').value=name.replace(/(?:\.(?:mp4|mkv|webm|mov|m4v|ogv|ogg))+$/i,'')+'.'+f.extension;
  el('mediaSize').textContent=bytes(f.filesize)+(f.video_codec?' | '+f.video_codec:'');
 }
 async function open(x){
  setup();el('mediaDialog').showModal();
  if(busy){el('mediaMessage').textContent='The current download is still being prepared.';return}
  source=x;analysis=null;job=null;el('mediaThumb').hidden=true;el('mediaMetadata').textContent='';el('mediaTitle').textContent=x.title||x.url;
  el('mediaOptions').hidden=true;el('mediaProgress').hidden=true;el('mediaValidation').textContent='';
  el('mediaMessage').classList.remove('media-error');el('mediaMessage').textContent='Analyzing formats on the media backend...';
  busy=true;
  try{
   analysis=await api('/analyze','POST',{url:x.url});
   if(!Array.isArray(analysis.formats)||!analysis.formats.length)throw new Error('No supported video format was returned by this source.');
   el('mediaTitle').textContent=analysis.title;try{const u=new URL(analysis.thumbnail);if(['http:','https:'].includes(u.protocol)){el('mediaThumb').src=u.href;el('mediaThumb').hidden=false}}catch{}el('mediaMetadata').textContent=[analysis.provider,analysis.uploader,analysis.duration?Number(analysis.duration).toFixed(1)+' seconds':null,typeof analysis.views==='number'?analysis.views.toLocaleString()+' source views':null,analysis.uploadDate].filter(Boolean).join(' | ');el('mediaFilename').value=analysis.title||'Video';
   el('mediaFormat').innerHTML=analysis.formats.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.label||f.extension)+' - '+esc(f.filesize?bytes(f.filesize):'size not yet known')+'</option>').join('');
   el('mediaOptions').hidden=false;el('mediaSave').hidden=true;el('mediaPrepare').hidden=false;
   el('mediaPrepare').disabled=false;el('mediaFormat').disabled=false;el('mediaCancel').hidden=true;
   el('mediaMessage').textContent='Select a format and edit the filename. VideoScope retrieves and validates the file before delivery.';syncFormat();
  }catch(e){fail(e)}finally{busy=false}
 }
 async function save(){
  if(job?.status!=='ready')return;
  const d=await api('/jobs/'+job.jobId+'/ticket','POST',{filename:el('mediaFilename').value});
  const a=document.createElement('a');a.href=d.downloadUrl;a.download=d.filename;a.rel='noopener';a.style.display='none';document.body.append(a);a.click();a.remove();
  el('mediaMessage').textContent='Download handed to your browser. Use Save video to device again if the browser asks for another tap.';
 }
 async function prepare(){
  if(busy||!analysis)return;busy=true;
  el('mediaPrepare').disabled=true;el('mediaFormat').disabled=true;el('mediaSave').hidden=true;
  el('mediaProgress').hidden=false;el('mediaProgress').removeAttribute('value');el('mediaMessage').classList.remove('media-error');
  try{
   job=await api('/download','POST',{analysisId:analysis.analysisId,formatId:el('mediaFormat').value,filename:el('mediaFilename').value});
   el('mediaCancel').hidden=false;
   while(!['ready','failed','cancelled'].includes(job.status)){
    el('mediaMessage').textContent=({queued:'Waiting for the media worker...',retrieving:'Retrieving media...',finishing:'Combining the video and audio...',validating:'Validating the video file...'}[job.stage]||'Preparing video...')+' '+bytes(job.bytes)+(job.total?' / '+bytes(job.total):'');
    if(job.total){el('mediaProgress').value=Math.min(100,job.bytes/job.total*100)}else el('mediaProgress').removeAttribute('value');
    await new Promise(r=>setTimeout(r,1000));job=await api('/jobs/'+job.jobId);
   }
   if(job.status!=='ready')throw new Error(job.error?.message||'Preparation was cancelled.');
   el('mediaProgress').value=100;el('mediaPrepare').hidden=true;el('mediaSave').hidden=false;
   el('mediaValidation').textContent='Validated: '+bytes(job.verified?.bytes)+', '+Number(job.verified?.duration||0).toFixed(1)+' seconds, '+(job.verified?.width||'?')+' x '+(job.verified?.height||'?')+'.';
   await save();
  }catch(e){fail(e)}finally{busy=false;el('mediaCancel').hidden=true;el('mediaPrepare').disabled=false;el('mediaFormat').disabled=false}
 }
 return {open};
})();
