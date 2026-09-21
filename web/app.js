'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe = v => {try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
  const read = (key,fallback) => {try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}};
  const write = (key,value) => {try{localStorage.setItem(key,JSON.stringify(value));}catch{/* The backend remains authoritative. */}};
  const state = {workspace:read('videoscope-workspace-v33',null),collection:null,job:null,items:[],total:0,page:1,size:24,saved:false,bookmarks:new Set(),revision:0,request:0,polling:false};
  if(!/^[a-zA-Z0-9_-]{24,100}$/.test(state.workspace||'')){state.workspace=crypto.randomUUID().replaceAll('-','');write('videoscope-workspace-v33',state.workspace);}
  const metric = n => n === null || n === undefined ? 'Unavailable' : Number(n).toLocaleString();
  const duration = n => n == null ? 'Duration unavailable' : `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
  const active = j => j && ['queued','enumerating','enriching'].includes(j.status);
  async function api(path,body,method) {
    const r=await fetch('/api/'+path,{method:method || (body ? 'POST' : 'GET'),headers:{'content-type':'application/json','x-videoscope-workspace':state.workspace},body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw new Error(data.detail || 'The collection service could not complete this request.');return data;
  }
  function error(e){$('status').hidden=false;$('statusTitle').textContent='Unable to complete request';$('statusText').textContent=e.message;$('status').className='status error';}
  function theme(value){document.documentElement.dataset.theme=value;$('themeButton').textContent=value==='dark'?'Light mode':'Dark mode';write('videoscope-theme',value);}
  const numeric=['minViews','maxViews','minLikes','maxLikes','minComments','maxComments','minRating','maxRating','minDuration','maxDuration'];
  function params(){
    const p=new URLSearchParams({page:String(state.page),pageSize:String(state.size),sort:$('sort').value});
    for(const [id,key] of [['query','q'],['uploader','uploader'],['providerFilter','provider'],['resolution','resolution'],...numeric.map(x=>[x,x])])if($(id).value)p.set(key,$(id).value);
    for(const [id,key] of [['hdOnly','hd'],['knownViews','knownViews'],['hasThumbnail','hasThumbnail'],['downloadSupported','download']])if($(id).checked)p.set(key,'true');
    const period=$('period').value;$('customDates').hidden=period!=='custom';p.set('period',period);
    if(period==='custom'){if($('dateFrom').value)p.set('from',$('dateFrom').value);if($('dateTo').value)p.set('to',$('dateTo').value);}
    else if(period!=='all'){const end=new Date();end.setHours(24,0,0,0);const start=new Date(end);start.setDate(start.getDate()-(period==='today'?1:Number(period)));p.set('from',start.toISOString());p.set('to',end.toISOString());}
    return p;
  }
  function path(p){return state.saved?'bookmarks?'+p:'collections/'+state.collection.id+'/videos?'+p;}
  async function results(){
    if(!state.collection&&!state.saved)return;
    const request=++state.request,data=await api(path(params()));if(request!==state.request)return;
    state.items=data.items;state.total=data.total;state.bookmarks=new Set(data.items.filter(v=>v.bookmarked).map(v=>v.id));
    if(state.page>1&&!data.items.length){state.page=Math.max(1,Math.ceil(data.total/state.size));return results();}
    render();
  }
  function render(){
    const grid=$('videoGrid');grid.innerHTML='';document.body.classList.toggle('blurred',$('blurPreviews').checked);
    for(const [i,v] of state.items.entries()){
      const article=document.createElement('article');article.className='video-card';article.dataset.id=v.id;
      article.innerHTML=`<div class="thumb">${safe(v.thumbnailUrl)?`<img src="${esc(safe(v.thumbnailUrl))}" alt="Original video thumbnail" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<div class="fallback">Thumbnail unavailable</div>'}<span class="rank">#${(state.page-1)*state.size+i+1}</span><button class="save" data-save="${esc(v.id)}" aria-label="${(v.bookmarked||state.bookmarks.has(v.id))?'Remove bookmark':'Save video'}" aria-pressed="${state.bookmarks.has(v.id)}">★</button>${v.isHD?'<span class="hd-badge">HD</span>':''}<span class="duration-badge">${esc(duration(v.durationSeconds))}</span></div><div class="card-body"><a class="card-title" href="${esc(safe(v.canonicalUrl))}" target="_blank" rel="noopener noreferrer">${esc(v.title)}</a><div class="source-name">${esc(v.uploader||v.sourceHost)}</div><div class="card-numbers"><div><small>Views</small><strong class="${v.views==null?'metric-unavailable':''}">${metric(v.views)}</strong></div><div><small>Likes</small><strong class="${v.likes==null?'metric-unavailable':''}">${metric(v.likes)}</strong></div></div><div class="card-date">${esc(v.relativePublishedText || (v.publishedAt?new Date(v.publishedAt).toLocaleDateString():'Upload date unavailable'))}${v.datePrecision==='approximate'?'<small>≈ Estimated from source age</small>':''}</div><div class="card-actions"><button data-detail="${esc(v.id)}">All details</button><a href="${esc(safe(v.canonicalUrl))}" target="_blank" rel="noopener noreferrer">Open original ↗</a></div></div>`;
      article.querySelector('img')?.addEventListener('error',e=>{e.target.replaceWith(Object.assign(document.createElement('p'),{className:'fallback',textContent:'Source thumbnail unavailable'}));},{once:true});grid.append(article);
    }
    $('collectionTitle').textContent=state.collection||state.saved?`${metric(state.total)} matching videos`:'One link. A clearer collection.';
    $('collectionSource').textContent=state.saved?'YOUR BOOKMARKS':state.collection?.provider?.toUpperCase()||'READY WHEN YOU ARE';
    $('collectionSummary').textContent=state.saved?'Bookmarks in this device workspace':state.collection?.label||'Verified video entries will appear here.';
    $('emptyState').hidden=state.items.length>0;
    $('emptyTitle').textContent=state.job?.status==='failed'?'Source needs attention':state.total===0&&state.collection?'No matching records in this collection':'Your next discovery starts here.';
    $('emptyText').textContent=state.job?.errors?.at(-1)?.message || (active(state.job)?'The backend is collecting metadata. Results appear as pages are saved.':'Adjust filters or paste a supported public source.');
    const pages=Math.max(1,Math.ceil(state.total/state.size));$('resultPagination').hidden=!state.total;$('resultPage').textContent=`Page ${state.page} of ${pages}`;$('prevResults').disabled=state.page<=1;$('nextResults').disabled=state.page>=pages;$('tableButton').disabled=!state.total;
  }
  function jobView(j){
    state.job=j;write('videoscope-v4-last-job',j.id);$('status').hidden=false;
    const label={queued:'Queued',enumerating:'Reading the public collection',enriching:'Enriching metadata',complete:'Complete',partial:'Partial coverage',paused:'Paused',failed:'Source needs attention',cancelled:'Cancelled'}[j.status];
    $('statusTitle').textContent=j.errors?.at(-1)?.message || `${label} — ${metric(j.uniqueItemsCollected)}${j.expectedCount==null?'':' / '+metric(j.expectedCount)} unique videos`;
    $('statusText').textContent=`${j.providerCapabilities?.name || j.provider} · ${j.pagesRead} pages · ${j.requestsMade} requests${j.status==='enriching'?' · Metadata '+j.enrichedCount+' / '+j.uniqueItemsCollected:''}${j.retries?' · Retrying saved cursor ('+j.retries+')':''}${j.warnings?.length?' · '+j.warnings.at(-1):''}`;
    $('status').className='status '+(j.status==='complete'?'success':['failed','partial'].includes(j.status)?'error':'');
    $('pauseButton').hidden=!active(j);$('cancelButton').hidden=!active(j)&&j.status!=='paused';$('resumeButton').hidden=!['paused','partial','failed'].includes(j.status);$('retryButton').hidden=!['failed','partial','complete','cancelled'].includes(j.status);
    $('scanProgress').hidden=!active(j);if(j.expectedCount){$('scanProgress').max=j.expectedCount;$('scanProgress').value=j.uniqueItemsCollected;}else $('scanProgress').removeAttribute('value');
    $('statVideos').textContent=metric(j.uniqueItemsCollected);$('statCoverage').textContent=j.expectedCount==null?label:`${label} · of ${metric(j.expectedCount)} reported`;$('statPages').textContent=metric(j.pagesRead);$('statPagesNote').textContent=j.strategy;
    $('diagnosticContent').textContent=JSON.stringify({scanId:j.id,provider:j.provider,status:j.status,expected:j.expectedCount,collected:j.uniqueItemsCollected,pages:j.pagesRead,requests:j.requestsMade,nextCursor:j.nextCursor,warnings:j.warnings,errors:j.errors,attempts:j.diagnostics},null,2);
  }
  function coverage(c){const m=c.metadataCoverage||{},total=c.job.uniqueItemsCollected;$('statViews').textContent=metric(m.totalViews);$('statViewsNote').textContent=`${m.views||0} / ${total} have known views`;$('statMetadata').textContent=total?`${Math.round((m.thumbnailUrl||0)/total*100)}%`:'—';$('statMetadataNote').textContent='Have a source thumbnail';$('coverageChips').hidden=!total;$('coverageChips').innerHTML=Object.entries(m).filter(([k])=>k!=='totalViews').map(([k,v])=>`<span>${esc(({title:'Titles',thumbnailUrl:'Thumbnails',views:'Views',likes:'Likes',comments:'Comments',rating:'Ratings',publishedAt:'Dates',durationSeconds:'Duration'})[k]||k)} <strong>${v}/${total}</strong></span>`).join('');}
  async function openCollection(id){state.saved=false;state.collection=await api('collections/'+id);state.page=1;$('sourceUrl').value=state.collection.input_url;jobView(state.collection.job);coverage(state.collection);await results();}
  async function recent(){const list=await api('collections');$('recentCollections').innerHTML=list.length?list.map(c=>`<button class="recent-item" data-id="${c.id}"><strong>${esc(c.label)}</strong><small>${c.item_count} videos · ${esc(c.status)}</small></button>`).join(''):'<p>Your next collection starts with a link.</p>';}
  async function bookmarkCount(){const data=await api('bookmarks?pageSize=96');$('savedCount').textContent=data.total;$('mobileSavedCount').textContent=data.total;}
  async function poll(){if(state.polling||!active(state.job))return;state.polling=true;try{const previous=state.job, j=await api('scans/'+previous.id);if(state.job.id!==j.id)return;jobView(j);if(previous.revision!==j.revision && !state.saved){state.collection=await api('collections/'+j.collectionId);coverage(state.collection);await results();if(!active(j))await recent();}}catch(e){$('statusText').textContent='Connection interrupted. The backend retains scan progress. '+e.message;}finally{state.polling=false;}}
  async function analyze(){
    $('scanButton').disabled=true;try{const url=$('sourceUrl').value.trim(),info=await api('detect',{url});$('providerDetected').textContent=`${info.capabilities.name} · ${info.sourceType} · ${info.capabilities.configured?'Configured':`Setup required: ${info.capabilities.credential}`}`;
      const j=await api('scans',{url,enrich:$('enrichDetails').checked,mode:$('cacheMode').value});jobView(j);await openCollection(j.collectionId);await recent();
    }finally{$('scanButton').disabled=false;}
  }
  function detail(id){const v=state.items.find(v=>v.id===id);if(!v)return;
    const values={Provider:v.provider,Uploader:v.uploader,Views:v.views,Likes:v.likes,Comments:v.comments,Rating:v.rating==null?null:`${v.rating}${v.ratingScale?' / '+v.ratingScale:''}`,Duration:duration(v.durationSeconds),'Published at':v.publishedAt,'Source age':v.relativePublishedText,'Date precision':v.datePrecision,Availability:v.availability,Resolution:v.width&&v.height?`${v.width} × ${v.height}`:null};
    $('detailContent').innerHTML=`<h2 class="detail-title">${esc(v.title)}</h2><a class="btn primary" href="${esc(safe(v.canonicalUrl))}" target="_blank" rel="noopener noreferrer">Open original video ↗</a><dl class="detail-metrics">${Object.entries(values).map(([k,value])=>`<div><dt>${esc(k)}</dt><dd>${esc(value??'Unavailable')}</dd></div>`).join('')}</dl><p>${esc(v.description||'Description unavailable')}</p><p>${esc([...v.tags,...v.categories].join(' · '))}</p>${v.downloadCapability==='direct-mp4'?`<div class="direct-download"><label>Filename<input id="downloadFilename" maxlength="100" value="${esc(v.title.replace(/\.mp4$/i,''))}"></label><button class="btn primary download-action" data-download="${esc(v.id)}">Download MP4</button><p id="downloadStatus" role="status">Public MP4 · up to 16 MB</p></div>`:'<p>Download unavailable for this source.</p>'}<details><summary>Metadata sources</summary><pre class="detail-source-notes">${esc(JSON.stringify(v.metadataSources,null,2))}</pre></details>`;$('detailDialog').showModal();
  }
  $('detailContent').onclick=async e=>{
    const button=e.target.closest('[data-download]');if(!button)return;button.disabled=true;
    try{$('downloadStatus').textContent='Fetching and validating the file…';
      const response=await fetch('/api/downloads',{method:'POST',headers:{'content-type':'application/json','x-videoscope-workspace':state.workspace},body:JSON.stringify({id:button.dataset.download,filename:$('downloadFilename').value})});
      if(!response.ok){const data=await response.json();throw new Error(data.detail||'Download failed.');}
      const blob=await response.blob(),name=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'video.mp4';
      download(blob,'video/mp4',name);$('downloadStatus').textContent='File ready. Check your browser downloads.';
    }catch(error){$('downloadStatus').textContent=error.message;}finally{button.disabled=false;}
  };
  function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportData(csv=false){const p=params();p.set('pageSize','96');const items=[];for(let page=1;;page++){p.set('page',String(page));const data=await api(path(p));items.push(...data.items);if(items.length>=data.total||!data.items.length)break;}
    if(csv){const keys=['title','canonicalUrl','provider','uploader','views','likes','comments','rating','ratingScale','publishedAt','datePrecision','durationSeconds','thumbnailUrl'],cell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};download('\ufeff'+[keys,...items.map(v=>keys.map(k=>v[k]))].map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8','videoscope-table.csv');}
    else download(JSON.stringify({version:'4.0.0',input:state.collection?.input_url,label:state.collection?.label,items},null,2),'application/json','videoscope-backup.json');
  }
  function reset(){for(const id of ['query','uploader','dateFrom','dateTo',...numeric])$(id).value='';for(const id of ['hdOnly','hasThumbnail','knownViews','downloadSupported'])$(id).checked=false;$('period').value='all';$('sort').value='views_desc';$('providerFilter').value='';$('resolution').value='';state.page=1;results().catch(error);}
  let debounce;
  function changed(){clearTimeout(debounce);debounce=setTimeout(()=>{state.page=1;results().catch(error);},180);}
  $('sourceForm').addEventListener('submit',e=>{e.preventDefault();analyze().catch(error);});
  for(const id of ['query','uploader','dateFrom','dateTo',...numeric])$(id).addEventListener('input',changed);
  for(const id of ['period','sort','providerFilter','resolution','hdOnly','knownViews','hasThumbnail','downloadSupported'])$(id).addEventListener('change',changed);
  $('pageSize').addEventListener('change',()=>{state.size=Number($('pageSize').value);state.page=1;results().catch(error);});
  $('prevResults').onclick=()=>{state.page--;results().catch(error);};$('nextResults').onclick=()=>{state.page++;results().catch(error);};$('resetFilters').onclick=reset;
  $('themeButton').onclick=()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark');theme(read('videoscope-theme','dark'));
  $('blurPreviews').checked=read('videoscope-blur',true);$('blurPreviews').onchange=()=>{write('videoscope-blur',$('blurPreviews').checked);render();};
  for(const [id,action] of [['pauseButton','pause'],['resumeButton','resume'],['cancelButton','cancel']])$(id).onclick=()=>api('scans/'+state.job.id+'/'+action,{}).then(jobView).catch(error);
  $('retryButton').onclick=()=>{$('cacheMode').value='full';analyze().catch(error);};
  $('recentCollections').onclick=e=>{const b=e.target.closest('[data-id]');if(b)openCollection(b.dataset.id).catch(error);};
  $('videoGrid').onclick=async e=>{const d=e.target.closest('[data-detail]'),b=e.target.closest('[data-save]');if(d)detail(d.dataset.detail);if(b){try{const id=b.dataset.save,remove=state.bookmarks.has(id)||state.saved;await api('bookmarks',{id},remove?'DELETE':'POST');await bookmarkCount();await results();}catch(e){error(e);}}};
  for(const id of ['navSaved','mobileSaved'])$(id).onclick=()=>{state.saved=true;state.page=1;results().catch(error);};
  for(const id of ['navExplore','mobileExplore'])$(id).onclick=()=>{state.saved=false;state.page=1;results().catch(error);};
  for(const id of ['toolsButton','settingsButton'])$(id).onclick=()=>$('toolsDialog').showModal();
  $('providersButton').onclick=()=>$('providersDialog').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('tableButton').onclick=()=>exportData(true).catch(error);$('exportButton').onclick=()=>exportData().catch(error);$('backupSaved').onclick=async()=>{try{const was=state.saved;state.saved=true;await exportData();state.saved=was;}catch(e){error(e);}};
  $('importButton').onclick=()=>{$('toolsDialog').close();$('importDialog').showModal();};
  $('importConfirm').onclick=async()=>{try{
    const file=$('importFile').files[0];if(!file||file.size>4_500_000)throw new Error('Choose a saved HTML page or VideoScope JSON backup smaller than 4.5 MB.');
    const text=await file.text();let data;try{data=JSON.parse(text);}catch{if(file.size>350_000)throw new Error('Saved HTML pages must be smaller than 350 KB. JSON backups may be up to 4.5 MB.');if(!$('importUrl').value)throw new Error('Enter the original public URL for this saved HTML page.');data=await api('imports/parse',{html:text,url:$('importUrl').value});}
    const items=Array.isArray(data)?data:data.items;if(!Array.isArray(items)||!items.length)throw new Error('The backup contains no video records.');
    $('importConfirm').disabled=true;const j=await api('imports',{url:$('importUrl').value||data.input||items[0].canonicalUrl||items[0].url});
    for(let offset=0;offset<items.length;offset+=24)await api('imports/'+j.id,{items:items.slice(offset,offset+24),label:data.label,final:offset+24>=items.length});
    $('importDialog').close();await openCollection(j.collectionId);await recent();
  }catch(e){$('importError').hidden=false;$('importError').textContent=e.message;}finally{$('importConfirm').disabled=false;}};

  async function init(){const config=await api('config');$('serviceVersion').textContent=`Connected to VideoScope ${config.version}`;$('providersContent').innerHTML=config.providers.map(p=>`<article><h3>${esc(p.name)}</h3><p>${esc(p.note)}</p><p>Collections: ${esc(p.enumeration)} · Downloads: ${p.download?'Public MP4 up to 16 MB':'unavailable'}</p><p>Metrics: ${esc(p.metrics.join(', '))}</p><p>${p.configured?'Configured':`Setup required: ${esc(p.credential)}`}</p></article>`).join('');await recent();await bookmarkCount();const id=read('videoscope-v4-last-job',null);if(id){try{const j=await api('scans/'+id);await openCollection(j.collectionId);}catch{/* Removed collections need no restoration. */}}render();}
  init().catch(error);setInterval(poll,2000);
})();
