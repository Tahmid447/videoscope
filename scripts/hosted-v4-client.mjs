import assert from 'node:assert/strict';

// Reads and idempotent controls can be retried; ambiguous creates are reconciled
// from the workspace collection index instead of blindly starting another scan.
export function client(site, workspace, {fetcher=fetch, sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  return async (path, body, method) => {
    method ||= body ? 'POST' : 'GET';
    const replayable=method==='GET' || method==='POST' && /\/(pause|resume|cancel)$/.test(path);
    for(let attempt=0;;attempt++) {
      let response;
      try {
        response=await fetcher(site+'/api/'+path, {method,headers:{'x-videoscope-workspace':workspace,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30_000)});
      } catch(error) {
        if(!replayable || attempt>=5)throw error;
        await sleep(Math.min(30_000,1000*2**attempt));continue;
      }
      if(replayable && (response.status===429 || response.status>=500) && attempt<5) {
        const retry=response.headers.get('retry-after');
        const retryMs=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):0;
        await response.body?.cancel();
        await sleep(Math.max(1000*2**attempt,Math.min(120_000,retryMs||0)));continue;
      }
      let data;
      try {data=await response.json();} catch(error) {
        if(!replayable || attempt>=5)throw error;
        await sleep(Math.min(30_000,1000*2**attempt));continue;
      }
      if(!response.ok)throw new Error(data.detail || `HTTP ${response.status}`);
      return data;
    }
  };
}

export function validateCompletion(name,j) {
  assert.ok(j.uniqueItemsCollected>0,'A live regression must collect actual records');
  assert.equal(j.errors.length,0,JSON.stringify(j.errors));
  if(name==='tokyomotion-search' && j.status==='partial') {
    // Honest source-limited coverage is part of the product contract. Interrupted
    // enumeration and unresolved advertised pages cannot pass this gate.
    assert.equal(j.phase,'enriching');assert.equal(j.nextCursor,null);
    assert.ok(!j.enumerationInterrupted);assert.ok(!j.currentCursor?.unresolvedGap);
    assert.ok(!j.warnings.some(w=>w.includes('remained unreadable')));
    assert.ok(j.pagesRead>25);assert.ok(j.expectedCount>j.uniqueItemsCollected);
    assert.equal(j.complete,false);assert.ok(j.warnings.some(w=>w.includes('Partial coverage')));
    assert.ok(j.diagnostics.some(d=>d.result==='reachable pagination exhausted'));
  } else assert.equal(j.status,'complete',JSON.stringify({name,status:j.status,warnings:j.warnings}));
}
