import { Store, hash } from './store.ts';
import { providerById } from './providers/index.ts';
import { transport, type TransportOptions } from './network.ts';
import { ProviderError, backoff } from './errors.ts';
import { type Credentials, type Provider, type ProviderContext, type ScanJob, type Diagnostic } from './model.ts';
export interface RunnerOptions { transport?: TransportOptions; provider?: Provider; read?: ProviderContext['read']; }
export async function runStep(store: Store, id: string, env: Credentials, options: RunnerOptions = {}): Promise<ScanJob | null> {
  const j = await store.claim(id); if (!j) return store.job(id);
  if (j.strategy === 'user import') { j.status='paused'; await store.commit(j,[],false); return store.job(id); }
  if (!await store.claimProvider(j)) { await store.releaseJob(j); return store.job(id); }
  const provider = options.provider || providerById(j.provider), diagnostics: Diagnostic[] = [];
  const read = options.read || transport({...options.transport, delayMs: provider.capabilities(env).delayMs, onRequest: d => {j.requestsMade++; diagnostics.push(d);},
    getCache: async url => {
      if(j.scanMode==='full' && new URL(url).pathname !== '/robots.txt')return null;
      const r = await store.db.prepare('SELECT response_json FROM response_cache WHERE cache_key=? AND expires_at>?').bind(hash(url),Date.now()).first<{response_json:string}>();
      if (!r) return null; const c = JSON.parse(r.response_json); return {...c,headers:new Headers(c.headers)};
    },
    putCache: async (url,r) => {
      if (r.text.length > 120_000) return;
      await store.db.prepare('INSERT INTO response_cache(cache_key,expires_at,response_json) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET expires_at=excluded.expires_at,response_json=excluded.response_json').bind(hash(url),Date.now()+provider.capabilities(env).cacheTtlSeconds*1000,JSON.stringify({...r,headers:Object.fromEntries(r.headers)})).run();
    },
  });
  const ctx: ProviderContext = {env,read,seen: cursor=>store.seen(j,cursor),collected:j.uniqueItemsCollected,expected:j.expectedCount,now:new Date().toISOString(),retryAttempt:j.retries};
  try {
    j.status = j.phase;
    if (j.phase === 'enriching') {
      const batch = provider.enrich ? await store.enrichBatch(j,provider.capabilities(env).enrichmentBatch || 1) : [];
      if (!batch.length) {
        j.status = j.partial || j.errors.length || j.expectedCount !== null && j.uniqueItemsCollected < j.expectedCount ? 'partial' : 'complete';
        j.complete = j.status === 'complete'; j.finishedAt = ctx.now; j.metadataCoverage = await store.coverage(j.collectionId);
        if (j.status === 'partial' && j.expectedCount !== null && j.uniqueItemsCollected < j.expectedCount) j.warnings.push(`${j.uniqueItemsCollected} / ${j.expectedCount} reported items publicly reached. Partial coverage.`);
        await store.commit(j,[],false);
      } else {
        const enriched = await provider.enrich!(batch,ctx);
        j.enrichedAfter = batch.at(-1)!.id; j.enrichedCount += batch.length; j.retries = 0;
        j.nextRunAt = Date.now()+provider.capabilities(env).delayMs; j.strategy = 'metadata enrichment';
        await store.commit(j,enriched,false);
      }
    } else {
      const cursor = j.nextCursor;
      j.currentCursor = cursor ?? {url:j.inputUrl};
      if (await store.seen(j,j.currentCursor)) throw new ProviderError('cursor_cycle','Provider repeated a completed cursor. Saved records are preserved; coverage is partial.');
      const page = await provider.enumerate({provider:j.provider,url:j.inputUrl,sourceType:j.sourceType},cursor,ctx);
      const unique = [...new Map(page.items.map(x=>[x.id,x])).values()];
      const repeated = unique.length && await store.repeated(j,hash(unique.map(x=>x.id).sort().join('|')));
      if (repeated && !page.repeatedPageAllowed) { page.partial = true; page.complete = true; page.nextCursor = null; page.warnings = [...page.warnings || [],'Source repeated the same result page. Pagination coverage is partial.']; }
      if (!unique.length && page.complete && !page.empty && !j.uniqueItemsCollected) throw new ProviderError('extraction_failed','No verified video entries were returned; extraction was not a successful empty collection.');
      if (page.expectedCount !== undefined && page.expectedCount !== null) {
        if (j.expectedCount !== null && j.expectedCount !== page.expectedCount) j.warnings.push('The source-reported total changed during this scan.');
        j.expectedCount = Math.max(j.expectedCount || 0,page.expectedCount);
      }
      j.pagesRead++; j.itemsReceived=(j.itemsReceived||0)+page.items.length; j.retries = 0; j.nextCursor = page.nextCursor; j.partial ||= !!page.partial;
      j.warnings = [...new Set([...j.warnings,...page.warnings || []])].slice(-30);
      j.diagnostics = [...j.diagnostics,...diagnostics,...page.diagnostics || []].slice(-50);
      j.strategy = page.diagnostics?.at(-1)?.strategy || j.strategy;
      if (page.complete) {
        j.phase = 'enriching'; j.status = 'enriching';
        if (!j.enrichment || !provider.enrich) j.enrichedAfter = '\uffff';
      } else if (page.nextCursor === null) throw new ProviderError('pagination_failed','Provider did not finish and did not supply a continuation cursor.');
      j.nextRunAt = Date.now()+provider.capabilities(env).delayMs;
      await store.commit(j,unique,true,page.label);
    }
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError('internal_error','The provider could not finish this step. Saved records and the cursor are preserved.',500);
    j.diagnostics = [...j.diagnostics,...diagnostics,{strategy:j.strategy,result:e.code}].slice(-50);
    if (e.retryable && j.retries < 4) { j.retries++; j.nextRunAt = Date.now()+backoff(j.retries,e.retryAfterMs); j.warnings = [...new Set([...j.warnings,`Retrying saved cursor after ${e.code}.`])].slice(-30); }
    else if (j.phase === 'enriching' && e.code !== 'credential_missing') {
      const batch = await store.enrichBatch(j,provider.capabilities(env).enrichmentBatch || 1);
      if (batch.length) { j.enrichedAfter = batch.at(-1)!.id; j.enrichedCount += batch.length; }
      j.warnings = [...new Set([...j.warnings,`Some detail metadata is unavailable (${e.code}); listing records were kept.`])].slice(-30); j.retries = 0; j.nextRunAt = Date.now()+1000;
    } else {
      j.errors.push({code:e.code,message:e.message});
      j.enumerationInterrupted = j.phase === 'enumerating';
      if (j.uniqueItemsCollected && j.enrichment && provider.enrich) {j.phase='enriching';j.status='enriching';j.retries=0;j.nextRunAt=Date.now()+1000;}
      else {j.status=j.uniqueItemsCollected?'partial':'failed';j.finishedAt=ctx.now;}
    }
    await store.commit(j,[],false);
  } finally {
    await store.releaseProvider(j);
    const saved=await store.job(j.id);
    if(saved)console.log(JSON.stringify({event:'scan_step',scanId:saved.id,provider:saved.provider,sourceType:saved.sourceType,cursorHash:hash(JSON.stringify(saved.currentCursor)).slice(0,12),pagesRead:saved.pagesRead,itemsReceived:saved.itemsReceived||0,uniqueItems:saved.uniqueItemsCollected,duplicates:Math.max(0,(saved.itemsReceived||0)-saved.uniqueItemsCollected),requestsMade:saved.requestsMade,requests:diagnostics,retries:saved.retries,expectedCount:saved.expectedCount,status:saved.status}));
  }
  return store.job(id);
}
