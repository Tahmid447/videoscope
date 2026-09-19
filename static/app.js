'use strict';
const $=id=>document.getElementById(id);
const state={collection:null,collections:[],items:[],filtered:[],saved:new Set(JSON.parse(localStorage.getItem('videoscope-saved')||'[]')),theme:localStorage.getItem('videoscope-theme')||'dark',lastUrl:'',running:false};
const savedRecords=JSON.parse(localStorage.getItem('videoscope-saved-records')||'{}');

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeUrl(v){try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:''}catch{return ''}}
function num(v){return typeof v==='number'&&Number.isFinite(v)}
function compact(v){if(!num(v))return '—';return new Intl.NumberFormat(undefined,{notation:v>=1000?'compact':'standard',maximumFractionDigits:1}).format(v)}
function dateOf(x){if(!x?.published_at)return null;const d=new Date(x.published_at);return Number.isNaN(d.getTime())?null:d}
function prettyDate(x){const d=dateOf(x);return d?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Date unavailable'}
function host(v){try{return new URL(v).hostname.replace(/^www\./,'')}catch{return 'source'}}
function toast(message){let t=document.querySelector('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}t.textContent=message;clearTimeout(t._timer);t._timer=setTimeout(()=>t.remove(),2800)}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});let data;try{data=await res.json()}catch{throw new Error('The hosted API returned an unreadable response.')}if(!res.ok)throw new Error(data?.detail||'The request failed.');return data}

function setTheme(theme){state.theme=theme;document.documentElement.dataset.theme=theme;localStorage.setItem('videoscope-theme',theme);$('themeButton').textContent=theme==='dark'?'Light mode':'Dark mode';const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='dark'?'#0b0f14':'#f4f7fa'}
function setStatus(kind,title,text=''){$('status').hidden=false;$('status').className='status '+kind;$('statusTitle').textContent=title;$('statusText').textContent=text;$('retryButton').hidden=kind!=='error'}
function clearStatus(){$('status').hidden=true}
function persistSaved(){localStorage.setItem('videoscope-saved',JSON.stringify([...state.saved]));localStorage.setItem('videoscope-saved-records',JSON.stringify(savedRecords));$('savedCount').textContent=state.saved.size}

function refreshStats(){
 const items=state.items;
 $('statVideos').textContent=items.length?items.length.toLocaleString():'—';
 const known=items.filter(x=>num(x.views));$('statViews').textContent=known.length?compact(known.reduce((a,x)=>a+x.views,0)):'—';
 const cutoff=Date.now()-7*86400000;$('statRecent').textContent=items.some(dateOf)?items.filter(x=>dateOf(x)?.getTime()>=cutoff).length.toLocaleString():'—';
 $('statPages').textContent=state.collection?String(state.collection.pages||0):'—';
}
function filterAndSort(){
 const q=$('query').value.trim().toLowerCase(),period=$('period').value,sort=$('sort').value;
 let items=[...state.items];
 if(q)items=items.filter(x=>[x.title,x.creator,x.source].join(' ').toLowerCase().includes(q));
 if(period!=='all'){const days=period==='today'?1:Number(period),cutoff=Date.now()-days*86400000;items=items.filter(x=>dateOf(x)?.getTime()>=cutoff)}
 const map={views_desc:['views',-1],likes_desc:['likes',-1],rating_desc:['rating',-1],published_desc:['published_at',-1],published_asc:['published_at',1],duration_desc:['duration_seconds',-1],duration_asc:['duration_seconds',1]};
 const [key,dir]=map[sort]||['views',-1];
 items.sort((a,b)=>{const av=key==='published_at'?(dateOf(a)?.getTime()??null):(num(a[key])?a[key]:null),bv=key==='published_at'?(dateOf(b)?.getTime()??null):(num(b[key])?b[key]:null);if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;if(av==null&&bv==null)return String(a.title||'').localeCompare(String(b.title||''));return (av-bv)*dir});
 state.filtered=items;renderCards();
}
function renderCards(){
 const grid=$('videoGrid');grid.innerHTML='';
 $('emptyState').hidden=state.filtered.length>0;
 $('exportButton').disabled=!state.filtered.length;
 state.filtered.forEach((x,i)=>{
  const article=document.createElement('article');article.className='video-card';
  const thumb=safeUrl(x.thumbnail_url||x.thumbnail),url=safeUrl(x.url),saved=state.saved.has(x.id);
  article.innerHTML=`<div class="thumb">${thumb?`<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<div class="fallback">▶</div>'}<span class="rank">#${i+1}</span><button class="save ${saved?'saved':''}" data-save="${esc(x.id)}" aria-label="${saved?'Remove bookmark':'Save video'}">★</button></div><div class="card-body"><a class="card-title" href="${esc(url)}" target="_blank" rel="noopener">${esc(x.title||'Untitled video')}</a><div class="source-name">${esc(x.creator||x.source||host(x.url||''))}</div><div class="meta"><span>👁 ${compact(x.views)}</span><span>${num(x.likes)?'♥ '+compact(x.likes):num(x.rating)?'★ '+x.rating:'—'}</span></div><div class="meta"><span>${esc(prettyDate(x))}</span><span>${num(x.duration_seconds)?Math.floor(x.duration_seconds/60)+':'+String(x.duration_seconds%60).padStart(2,'0'):''}</span></div></div>`;
  grid.appendChild(article);
 });
}
function showCollection(c){state.collection=c;state.items=c?.items||[];state.lastUrl=c?.input||state.lastUrl;if(c?.input)$('sourceUrl').value=c.input;$('collectionSource').textContent=c?host(c.input||'')+' · VIDEO COLLECTION':'READY WHEN YOU ARE';$('collectionTitle').textContent=c?(c.item_count||state.items.length)+' videos collected':'Your next discovery starts here.';$('collectionSummary').textContent=c?.label||'Paste a link above to create a collection.';refreshStats();filterAndSort()}
async function refreshCollections(){try{state.collections=await api('/api/collections');const box=$('recentCollections');box.innerHTML=state.collections.length?'':'<p>Your scans will appear here.</p>';state.collections.slice(0,20).forEach(c=>{const b=document.createElement('button');b.className='recent-item';b.dataset.id=c.id;b.innerHTML='<strong>'+esc(c.label||host(c.input))+'</strong><small>'+esc(String(c.item_count||0))+' videos</small>';box.appendChild(b)})}catch(e){setStatus('error','Scanner connection failed',e.message)}}
async function openCollection(id){const c=await api('/api/collections/'+encodeURIComponent(id));showCollection(c)}

async function analyze(){
 if(state.running)return;
 const url=$('sourceUrl').value.trim();if(!/^https?:\/\//i.test(url)){setStatus('error','Paste a complete public URL','The address must begin with http:// or https://');return}
 state.lastUrl=url;state.running=true;$('scanButton').disabled=true;setStatus('','Starting scan…',host(url));
 try{
  let job=await api('/api/scans',{method:'POST',body:JSON.stringify({url,pages:Number($('scanDepth').value)||5})});
  for(let guard=0;guard<210;guard++){
   setStatus('',job.message||'Scanning…',`${job.pages||0} pages · ${job.items||0} videos`);
   if(['complete','partial','failed','stopped'].includes(job.status))break;
   job=await api('/api/scans/'+job.id+'/step',{method:'POST',body:'{}'});
   if(job.collection_id){try{showCollection(await api('/api/collections/'+job.collection_id))}catch{}}
  }
  if(job.collection_id){showCollection(await api('/api/collections/'+job.collection_id));await refreshCollections()}
  if(job.status==='failed')setStatus('error',job.message||'Scan failed','The source did not return usable public video metadata.');
  else setStatus(job.status==='partial'?'error':'success',job.message||'Scan complete',`${job.pages||0} pages · ${job.items||0} videos`);
 }catch(e){setStatus('error','Could not analyze this page',e.message)}
 finally{state.running=false;$('scanButton').disabled=false}
}

function showSaved(){state.collection=null;state.items=Object.values(savedRecords).filter(x=>state.saved.has(x.id));$('collectionSource').textContent='SAVED IN THIS BROWSER';$('collectionTitle').textContent=state.items.length+' saved videos';$('collectionSummary').textContent='Bookmarks are stored on this device and do not download video files.';refreshStats();filterAndSort();document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));$('navSaved').classList.add('active')}
function toggleSaved(id){const item=state.items.find(x=>x.id===id)||savedRecords[id];if(state.saved.has(id)){state.saved.delete(id);delete savedRecords[id]}else if(item){state.saved.add(id);savedRecords[id]=item}persistSaved();filterAndSort()}

async function doImport(){
 const file=$('importFile').files[0];const err=$('importError');err.hidden=true;
 if(!file){err.hidden=false;err.textContent='Choose a JSON or HTML file first.';return}
 if(file.size>5*1024*1024){err.hidden=false;err.textContent='The file must be under 5 MB.';return}
 try{const c=await api('/api/import',{method:'POST',body:JSON.stringify({url:$('importUrl').value.trim(),filename:file.name,content:await file.text()})});$('importDialog').close();showCollection(c);await refreshCollections();toast('Collection imported.')}catch(e){err.hidden=false;err.textContent=e.message}
}

function exportJSON(){const blob=new Blob([JSON.stringify({version:1,exported_at:new Date().toISOString(),items:state.filtered},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='videoscope-collection.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

function bind(){
 setTheme(state.theme);persistSaved();
 $('themeButton').addEventListener('click',()=>setTheme(state.theme==='dark'?'light':'dark'));
 $('sourceForm').addEventListener('submit',e=>{e.preventDefault();analyze()});
 $('retryButton').addEventListener('click',analyze);
 $('query').addEventListener('input',filterAndSort);$('period').addEventListener('change',filterAndSort);$('sort').addEventListener('change',filterAndSort);
 $('resetFilters').addEventListener('click',()=>{$('query').value='';$('period').value='all';$('sort').value='views_desc';filterAndSort()});
 $('videoGrid').addEventListener('click',e=>{const b=e.target.closest('[data-save]');if(b){e.preventDefault();toggleSaved(b.dataset.save)}});
 $('recentCollections').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)openCollection(b.dataset.id).catch(x=>toast(x.message))});
 $('navExplore').addEventListener('click',()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));$('navExplore').classList.add('active');if(state.collection)showCollection(state.collection);else{state.items=[];showCollection(null)}});
 $('navSaved').addEventListener('click',showSaved);
 $('settingsButton').addEventListener('click',()=>$('settingsDialog').showModal());
 $('importButton').addEventListener('click',()=>$('importDialog').showModal());
 $('importConfirm').addEventListener('click',doImport);
 $('exportButton').addEventListener('click',exportJSON);
 refreshCollections();
 api('/api/config').catch(e=>setStatus('error','Hosted scanner is unavailable',e.message));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
