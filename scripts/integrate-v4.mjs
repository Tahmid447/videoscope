/* Idempotent, assertion-checked integration of the companion service. */
import {readFileSync,writeFileSync} from 'node:fs';
function edit(path,fn){const s=readFileSync(path,'utf8');writeFileSync(path,fn(s));}
function once(s,a,b){if(s.includes(b))return s;if(!s.includes(a))throw new Error('Missing integration anchor: '+a.slice(0,100));return s.replace(a,b)}
edit('media_api/security.py',s=>once(s,'    if len(raw) > 4096','    if not isinstance(raw, str):\n        raise MediaError("invalid_url", "Enter a complete HTTP or HTTPS video address.")\n    if len(raw) > 4096'));
edit('media_api/network.py',s=>once(s,'                response = await self.session.get(target, headers=headers, allow_redirects=False)',
 '                selected = {**getattr(self, "headers_by_host", {}).get(urlsplit(target).hostname, {}), **headers}\n                response = await self.session.get(target, headers=selected, allow_redirects=False)'));
edit('media_api/processing.py',s=>once(s,'    http, plan = analysis.http, fmt.plan',
 '    if fmt.stream_type == "extracted":\n        from .transfers import prepare_extracted\n        return await prepare_extracted(analysis, fmt, directory, settings, progress)\n    http, plan = analysis.http, fmt.plan'));
edit('media_api/providers/__init__.py',s=>{
 if(s.includes('async def analyze_generic('))return s;
 s=once(s,'async def analyze(http, url, owner, ident, settings):','async def analyze_generic(http, url, owner, ident, settings):');
 return s+`\n\nasync def analyze(http, url, owner, ident, settings):
    from .bridge import provider_name, analyze_provider
    url = public_url(url, settings.allowed_hosts)
    if provider_name(url):
        return await analyze_provider(http, url, owner, ident, settings)
    try:
        return await analyze_generic(http, url, owner, ident, settings)
    except MediaError as exc:
        if exc.code != 'no_stream':
            raise
        return await analyze_provider(http, url, owner, ident, settings)
`;
});
edit('lib/extract.mjs',s=>s.replace("VERSION='3.7.0'","VERSION='4.0.0'"));
edit('netlify/functions/api.mts',s=>{
 if(s.includes('const who=workspace(req)'))return s;
 s="import {mediaCall,mediaConfigured,providerRoute} from './_shared/media-bridge.mts';\n"+s;
 s=once(s,"default_scan_mode:'all',max_records:5000,detail_batch:1", "default_scan_mode:'all',max_records:10000,detail_batch:1,media_backend:mediaConfigured()");
 s=once(s,"  const prefix='w/'+workspace(req)+'/',store=storage(context)",`  const who=workspace(req);
  if(parts[0]==='media'){
   const path='/api/'+parts.slice(1).map(encodeURIComponent).join('/');
   const data=await mediaCall(who,path,req.method,['POST','PUT'].includes(req.method)?await body(req):undefined);
   return json(data);
  }
  if(['scans','collections'].includes(parts[0])&&/^e-[a-f0-9-]{36}$/.test(parts[1]||''))return json(await mediaCall(who,'/api/'+parts.map(encodeURIComponent).join('/'),req.method,req.method==='POST'?await body(req):undefined));
  const prefix='w/'+who+'/',store=storage(context)`);
 s=once(s,"return json(values.filter(Boolean).sort((a:any,b:any)=>b.updated_at.localeCompare(a.updated_at)))", "const remote=mediaConfigured()?await mediaCall(who,'/api/collections').catch(()=>[]):[];return json([...values.filter(Boolean),...remote].sort((a:any,b:any)=>b.updated_at.localeCompare(a.updated_at)))");
 s=once(s,"const cid=randomUUID(),jid=randomUUID()", "if(await providerRoute(who,u.href))return json(await mediaCall(who,'/api/scans','POST',{...b,url:u.href}),201);const cid=randomUUID(),jid=randomUUID()");
 s=once(s,"const result=await scanStep(j,c);await saveCollection(result.c);", "const result=await scanStep(j,c);if(result.job.status==='failed'&&!result.c.items.length&&mediaConfigured()&&!j.provider_fallback_attempted){j.provider_fallback_attempted=true;await set(key,j);return json(await mediaCall(who,'/api/scans','POST',{url:c.input,pages:j.scan_mode==='all'?'all':j.page_limit,enrich:j.enrich}));}await saveCollection(result.c);");
 return s;
});
edit('static/index.html',s=>{
 s=s.replace(/3\.7\.0/g,'4.0.0').replace(/v=370/g,'v=400').replace('VideoScope 3.7 \u00b7 Complete collection scans','VideoScope 4.0 \u00b7 Providers + real downloads');
 if(!s.includes('/media.js'))s=s.replace('</head>','<link rel="stylesheet" href="/media.css?v=400"><script defer src="/media.js?v=400"></script></head>');
 s=s.replace('Download actions appear when the source publishes a media file.','Analyze formats. Choose a filename. Download through VideoScope.');
 s=s.replace('All available pages collects the full listing before reading individual details. Keep this tab open while it runs; saved progress can be continued after a reload.','All available pages gathers the listing before optional individual details. Provider-backed scans keep running on the server. Saved scans can be resumed; original HTML scans need this tab open.');
 if(!s.includes('id="maxViews"'))s=s.replace('<label>Minimum likes', '<label>Maximum views<input id="maxViews" type="number" min="0" step="1" placeholder="Any"></label><label>Source<input id="sourceFilter" type="search" placeholder="Domain or website"></label><label>Uploader<input id="uploaderFilter" type="search" placeholder="Channel or creator"></label><label>Minimum likes');
 return s;
});
edit('static/app.js',s=>{
 s=s.replace(/3\.7\.0/g,'4.0.0');
 if(s.includes('data-download='))return s;
 const oldCard=`(downloadable(x)?'<a class="download-action" href="'+esc(safe(downloadable(x).url))+'" download="'+esc(fileName(x,downloadable(x)))+'" target="_blank" rel="noopener noreferrer">Download \u2193</a>':'')`;
 s=once(s,oldCard,`'<button class="download-action" data-download="'+esc(x.id)+'">Download \u2193</button>'`);
 const start=s.indexOf("+'<section class=\"detail-section\"><h3>Download</h3>"),end=s.indexOf("+(players.length?",start);
 if(start<0||end<0)throw new Error('Download detail section not found');
 s=s.slice(0,start)+`+'<section class="detail-section"><h3>Download</h3><button class="btn primary" data-download="'+esc(x.id)+'">Choose quality and download</button><p class="fine-print">The media backend retrieves and validates the file, then delivers it as an attachment with your chosen filename.</p></section>'`+s.slice(end);
 s=once(s,"if(more)detail(more.dataset.detail)});", "if(more)detail(more.dataset.detail);const dl=e.target.closest('[data-download]');if(dl){const x=state.items.find(x=>x.id===dl.dataset.download);if(x)window.VideoScopeMedia.open(x)}});");
 s=once(s,"$('detailContent').addEventListener('click',e=>{const b=", "$('detailContent').addEventListener('click',e=>{const dl=e.target.closest('[data-download]');if(dl){const x=state.items.find(x=>x.id===dl.dataset.download)||state.saved[dl.dataset.download];if(x){$('detailDialog').close();window.VideoScopeMedia.open(x)}return}const b=");
 s=s.replaceAll("['query','minViews','minLikes','minDuration','maxDuration','dateFrom','dateTo']", "['query','minViews','maxViews','sourceFilter','uploaderFilter','minLikes','minDuration','maxDuration','dateFrom','dateTo']");
 s=once(s,"if(q.some(t=>!hay.includes(t)))return false;", "if(q.some(t=>!hay.includes(t)))return false;if($('maxViews').value!==''&&(!num(x.views)||x.views>Number($('maxViews').value)))return false;if($('sourceFilter').value&&!String(x.source||'').toLocaleLowerCase().includes($('sourceFilter').value.trim().toLocaleLowerCase()))return false;if($('uploaderFilter').value&&!String(x.creator||'').toLocaleLowerCase().includes($('uploaderFilter').value.trim().toLocaleLowerCase()))return false;");
 s=once(s,"(job.pages||0)+' source pages \u00b7 '", "(job.provider_worker?'Provider scan':(job.pages||0)+' source pages')+' \u00b7 '");
 // Preserve the reader's current result page while progressive updates arrive.
 s=once(s,"function showCollection(c){state.collection=c;", "function showCollection(c){const unchanged=state.collection?.id===c?.id;state.collection=c;");
 s=once(s,"if(c?.input)$('sourceUrl').value=c.input;state.page=1;stats();filter()", "if(c?.input)$('sourceUrl').value=c.input;if(!unchanged)state.page=1;stats();filter()");
 return s;
});
edit('scripts/ui-check.mjs',s=>s.replace(/3\.7\.0/g,'4.0.0'));
edit('package.json',s=>{const p=JSON.parse(s);p.version='4.0.0';return JSON.stringify(p,null,2)+'\n'});
console.log('VideoScope 4 integration applied without changing the native listing parsers.');
