import { load } from 'cheerio/slim';
import { feedURL, wordpressPostURL } from '../../lib/extract.mjs';
import { htmlRecords, feedRecords, oembedRecord, wordpressRecords, sitemapRecords, parseWordPressPostMeta, parseDetail, fromLegacy } from '../extractors.ts';
import { ProviderError } from '../errors.ts';
import type { Provider, ProviderContext, Detection, Json, Page, Diagnostic } from '../model.ts';
type Mode = 'html' | 'feed' | 'wordpress' | 'sitemap' | 'candidate';
interface Cursor {url: string; mode: Mode; inferredWordPressPage?: boolean; pending?: {url: string; mode: Mode}[];}
function sameOrigin(target: string, root: string) { try { return new URL(target).origin === new URL(root).origin; } catch { return false; } }
export function scopedFeed(target: string, source: string): boolean {
  if(!sameOrigin(target,source))return false;
  const a=new URL(target), b=new URL(source);
  const path=(u:URL)=>u.pathname.replace(/\/feed\/?$/,'').replace(/\/$/,'');
  if(path(a)!==path(b))return false;
  for(const [key,value] of b.searchParams)if(!['page','paged','feed'].includes(key)&&a.searchParams.get(key)!==value)return false;
  return true;
}
function feedPage(text: string, url: string): Page {
  const result = feedRecords(text, url);
  if (!result.valid) throw new ProviderError('invalid_feed', 'The advertised feed did not return RSS or Atom.');
  const next = result.next && sameOrigin(result.next, url) ? {url: result.next, mode: 'feed', inferredWordPressPage: result.inferredWordPressPage} : null;
  return {items: result.items, nextCursor: next, complete: !next, empty: result.entries === 0, partial: result.bounded && result.entries > 0,
    label: result.title, warnings: result.bounded && result.entries ? ['This feed exposes a recent window without a historical cursor; archive coverage is partial.'] : [],
    diagnostics: [{strategy: 'RSS / Atom', result: `${result.entries} entries, ${result.items.length} with video evidence`, count: result.items.length}]};
}
async function wpPage(url: string, ctx: ProviderContext): Promise<Page> {
  const r = await ctx.read(url), data = JSON.parse(r.text);
  if (!Array.isArray(data)) throw new ProviderError('wordpress_response', 'WordPress did not return a post collection.');
  const items = wordpressRecords(data, url), pageCount = Number(r.headers.get('x-wp-totalpages')) || null, u = new URL(url), page = Number(u.searchParams.get('page') || 1);
  const next = pageCount && page < pageCount ? new URL(u) : null; next?.searchParams.set('page', String(page + 1));
  return {items, nextCursor: next ? {url: next.href, mode: 'wordpress'} : null, complete: !next, empty: data.length === 0, partial: pageCount === null && data.length > 0, diagnostics: [{strategy: 'WordPress REST', result: 'Video evidence checked in public posts', count: items.length}], warnings: pageCount === null && data.length ? ['WordPress did not expose a pagination total.'] : []};
}
async function enumerate(source: Detection, raw: Json, ctx: ProviderContext): Promise<Page> {
  const cursor = (raw || {url: source.url, mode: /\/feed\/?$|[?&]feed=/.test(source.url) ? 'feed' : /\/wp-json\/wp\/v2\/posts/.test(source.url) ? 'wordpress' : 'html'}) as unknown as Cursor;
  const diagnostics: Diagnostic[] = [];
  if (cursor.mode === 'wordpress') return wpPage(cursor.url, ctx);
  if (cursor.mode === 'feed') {
    try { const r = await ctx.read(cursor.url); return feedPage(r.text, r.url); }
    catch (e) {
      // WordPress returns 404 after its final paged archive feed. Only an
      // inferred continuation from a verified WordPress feed has this meaning.
      if (cursor.inferredWordPressPage && e instanceof ProviderError && e.status === 404)
        return {items: [], nextCursor: null, complete: true, empty: true, diagnostics: [{strategy: 'WordPress paged RSS', result: 'Archive exhausted at the next inferred page (404).'}]};
      throw e;
    }
  }
  if (cursor.mode === 'candidate') {
    const r = await ctx.read(cursor.url), parsed = parseDetail(r.text, r.url), next = cursor.pending?.[0];
    return {items: parsed.is_video ? [fromLegacy(parsed, 'generic')] : [], nextCursor: next ? {...next, pending: cursor.pending!.slice(1)} as unknown as Json : null, complete: !next, diagnostics: [{strategy: 'HTML candidate verification', result: parsed.is_video ? 'video metadata verified' : 'ordinary article excluded'}]};
  }
  if (cursor.mode === 'sitemap') {
    const r = await ctx.read(cursor.url), result = sitemapRecords(r.text, r.url);
    if (!result.valid) throw new ProviderError('sitemap_failed', 'Public sitemap was not readable.');
    const pending = [...(cursor.pending || [])];
    for (const url of result.sitemaps) if (sameOrigin(url, source.url) && !await ctx.seen(url) && !pending.some(p => p.url === url)) pending.push({url, mode: 'sitemap'});
    const next = pending.shift();
    return {items: result.items.filter(x => new URL(x.canonicalUrl).pathname.startsWith(new URL(source.url).pathname)), nextCursor: next ? {...next, pending} as unknown as Json : null, complete: !next, partial: true, warnings: ['Sitemap coverage includes only published video entries in the requested path; it may omit other videos.'], diagnostics: [{strategy: 'public video sitemap', result: 'video entries read', count: result.items.length}]};
  }
  let html = '', base = cursor.url, failure: unknown;
  let candidatePage: Page | null = null;
  try {
    const r = await ctx.read(cursor.url); base = r.url; html = r.text;
    if (/^(?:\s*<\?xml[^>]*>)?\s*<(?:rss|feed)\b/i.test(html)) return feedPage(html, base);
    const parsed = htmlRecords(html, base);
    diagnostics.push({strategy: 'JSON-LD / OpenGraph / HTML cards', result: parsed.items.length ? 'video metadata found' : 'no verified records', count: parsed.items.length});
    if (parsed.items.length) return {items: parsed.items, nextCursor: parsed.next ? {url: parsed.next, mode: 'html'} : null, complete: !parsed.next, expectedCount: parsed.expected, label: parsed.title, diagnostics};
    if (parsed.candidates.length) {
      // Preserve every candidate and every published listing page; no N-page cap.
      const pending: {url: string; mode: Mode}[] = parsed.candidates.filter(u => sameOrigin(u, source.url)).map(url => ({url, mode: 'candidate'}));
      if (parsed.next) pending.push({url: parsed.next, mode: 'html'});
      const first = pending.shift();
      if (first) candidatePage = {items: [], nextCursor: {...first, pending} as unknown as Json, complete: false, label: parsed.title, diagnostics};
    }
    const $ = load(html), discovery = $('link[type="application/json+oembed"]').attr('href');
    if (discovery) try {
      const r = await ctx.read(new URL(discovery, base).href), item = oembedRecord(JSON.parse(r.text), base);
      diagnostics.push({strategy: 'oEmbed', result: item ? 'video metadata found' : 'not a video'});
      if (item) return {items: [item], nextCursor: null, complete: true, expectedCount: 1, diagnostics};
    } catch (e) { diagnostics.push({strategy: 'oEmbed', result: e instanceof ProviderError ? e.code : 'invalid response'}); }
  } catch (e) { failure = e; diagnostics.push({strategy: 'HTML', result: e instanceof ProviderError ? e.code : 'request failed'}); }
  const $ = load(html), feeds = $('link[rel="alternate"][type="application/rss+xml"],link[rel="alternate"][type="application/atom+xml"]').map((_,el) => new URL($(el).attr('href')!, base).href).get();
  // A guessed fallback must preserve the exact collection and query scope.
  const u = new URL(base);
  if (!u.search && !/\/search\/?$/.test(u.pathname)) feeds.push(feedURL(base));
  for (const url of [...new Set(feeds)].filter(x => scopedFeed(x, source.url))) {
    try { const r = await ctx.read(url); const result = feedPage(r.text, r.url); if (result.items.length || result.empty) return {...result, diagnostics: [...diagnostics, ...result.diagnostics!]}; }
    catch (e) { diagnostics.push({strategy: 'RSS / Atom', result: e instanceof ProviderError ? e.code : 'parse failed'}); }
  }
  // WordPress root discovery is safe only for a root collection. A taxonomy
  // archive must use its scoped feed or an explicitly supplied scoped REST URL.
  const rest = $('link[rel="https://api.w.org/"]').attr('href');
  if (rest && u.pathname === '/' && !u.search) try {
    const api = new URL('wp/v2/posts?_embed=wp:featuredmedia,author,wp:term&per_page=50', rest);
    if (sameOrigin(api.href, source.url)) return {...await wpPage(api.href, ctx), diagnostics};
  } catch (e) { diagnostics.push({strategy: 'WordPress REST', result: e instanceof ProviderError ? e.code : 'parse failed'}); }
  if (candidatePage) return candidatePage;
  const sitemap = $('link[rel="sitemap"]').attr('href');
  if (sitemap && sameOrigin(new URL(sitemap, base).href, source.url)) return {items: [], nextCursor: {url: new URL(sitemap, base).href, mode: 'sitemap'}, complete: false, diagnostics};
  if (failure instanceof ProviderError && failure.retryable) throw failure;
  const error = new ProviderError(failure ? 'extraction_failed' : 'unsupported_source', `No supported public video collection surface was found. ${diagnostics.map(d => `${d.strategy}: ${d.result}`).join('; ')}`);
  throw error;
}
export const generic: Provider = {
  id: 'generic', detect: u => ({provider: /\/feed\/?$|[?&]feed=|\/wp-json\//.test(u.href) ? 'wordpress-rss' : 'generic', url: u.href, sourceType: 'collection'}),
  capabilities() { return {id: 'generic', name: 'Standards-compatible public collections', sourceTypes: ['video','profile','category','collection'], metrics: ['title','thumbnail','publishedAt','durationSeconds','uploader','tags'], enumeration: 'conditional', credential: null, configured: true, download: false, note: 'JSON-LD, OpenGraph, oEmbed, RSS/Atom, scoped WordPress REST, public video sitemaps and verified HTML cards. Incomplete feed windows are labeled partial.', delayMs: 750, cacheTtlSeconds: 1800, enrichmentBatch: 1}; },
  enumerate,
  async enrich(items, ctx) {
    const v = items[0];
    if (v.provider === 'wordpress-rss' && !v.thumbnailUrl) {
      const url = wordpressPostURL(v.canonicalUrl);
      if (url) { const r = await ctx.read(url), meta = parseWordPressPostMeta(r.text, r.url); if (meta?.thumbnail_url) return [{...v, thumbnailUrl: meta.thumbnail_url, metadataSources: {...v.metadataSources, thumbnailUrl: 'public WordPress featured media'}, enrichedAt: ctx.now}]; }
    }
    return [{...v, enrichedAt: ctx.now}];
  },
};
export const wordpressRss: Provider = {...generic, id: 'wordpress-rss', capabilities: env => ({...generic.capabilities(env), id: 'wordpress-rss', name: 'WordPress / RSS / Atom'})};
