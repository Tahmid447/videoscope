import { load } from 'cheerio/slim';
import { htmlRecords, parseDetail, fromLegacy } from '../extractors.ts';
import { type Provider, type Json, type Detection } from '../model.ts';
import { ProviderError } from '../errors.ts';
interface Cursor { url: string; orders: string[]; seenOrders: string[]; lastPage: number; maxAdvertisedPage: number; gaps?: string[]; rechecking?: boolean; unresolvedGap?: boolean; checkpointKey?: string; }
function scope(raw: string) { const u = new URL(raw); for (const k of ['o','page','paged']) u.searchParams.delete(k); u.searchParams.sort(); return u.href; }
function order(raw: string) { const u = new URL(raw); u.searchParams.delete('page'); u.searchParams.delete('paged'); if (u.searchParams.get('o') === 'mr') u.searchParams.delete('o'); u.searchParams.sort(); return u.href; }
function position(raw: string) { return Number(new URL(raw).searchParams.get('page') || 1); }
export function tokyoLinks(html: string, base: string, root: string) {
  const $ = load(html), pages = new Set<string>(), orders = new Set<string>(), current = new URL(base);
  $('a[href]').each((_, el) => {
    const a = $(el); if (a.closest('.disabled').length) return;
    let u: URL; try { u = new URL(a.attr('href')!, base); } catch { return; }
    if (scope(u.href) !== scope(root) || u.username || u.password) return;
    if (order(u.href) === order(base) && position(u.href) > position(base)) pages.add(u.href);
    if (current.pathname === '/search' && /^(Most Viewed|Most Recent|Most Commented|Top Rated|Top Favorites)$/i.test(a.text().trim()) && /^(mv|mr|md|tr|tf)$/.test(u.searchParams.get('o') || '')) orders.add(order(u.href));
  });
  return {pages: [...pages].sort((a,b) => position(a) - position(b)), orders: [...orders]};
}
export const tokyomotion: Provider = {
  id: 'tokyomotion',
  detect(u) {
    if (!['tokyomotion.net', 'www.tokyomotion.net'].includes(u.hostname)) return null;
    const url = new URL(u); url.hostname = 'www.tokyomotion.net'; url.protocol = 'https:'; url.searchParams.delete('page');
    const sourceType: Detection['sourceType'] = /^\/video\/\d+/.test(u.pathname) ? 'video' : /^\/user\/[^/]+\/videos/.test(u.pathname) ? 'profile' : u.pathname === '/search' ? 'search' : /^\/(?:category|categories)\//.test(u.pathname) ? 'category' : 'collection';
    return {provider: 'tokyomotion', sourceType, url: url.href};
  },
  capabilities() { return {id: 'tokyomotion', name: 'TokyoMotion', sourceTypes: ['video','profile','search','category','collection'], metrics: ['title','thumbnail','views','rating','durationSeconds','relativePublishedText'], enumeration: true, credential: null, configured: true, download: false, note: 'Public listing metadata. Published sort windows preserve the exact search scope. Relative dates remain approximate.', delayMs: 1000, cacheTtlSeconds: 900, enrichmentBatch: 1}; },
  async enumerate(source, raw, ctx) {
    const cursor: Cursor = raw ? structuredClone(raw) as unknown as Cursor : {url: source.url, orders: [], seenOrders: [order(source.url)], lastPage: 1, maxAdvertisedPage: 1};
    cursor.gaps ??= [];
    const page = await ctx.read(cursor.url), result = htmlRecords(page.text, page.url, 'tokyomotion');
    const links = tokyoLinks(page.text, page.url, source.url);
    // Numeric pagers publish a reachable range, often as 2, 3, …, 49, 50.
    // Read every page in that range even when an intermediate response omits
    // its pager. The bound comes from source links, never an application cap.
    cursor.lastPage = Math.max(cursor.lastPage || 1, ...links.pages.map(position).filter(Number.isSafeInteger));
    cursor.maxAdvertisedPage = Math.max(cursor.maxAdvertisedPage || 1, cursor.lastPage);
    for (const url of links.orders) if (!cursor.orders.includes(url) && !cursor.seenOrders.includes(url)) cursor.orders.push(url);
    const expected = result.expected ?? ctx.expected;
    const empty = /(?:no videos found|no videos available|\b0 videos\b|showing 0 to 0 of 0 videos)/i.test(load(page.text).text());
    const unexpectedEmpty = !result.items.length && (!empty || position(cursor.url) < cursor.lastPage && (ctx.expected || 0) > 0);
    if (unexpectedEmpty) {
      // Let the scheduler retry the same cursor without advancing or losing records.
      if (ctx.retryAttempt < 2) throw new ProviderError('empty_intermediate_page', 'TokyoMotion returned an empty advertised page; retrying this page.', 503, true);
      if(cursor.rechecking) cursor.unresolvedGap=true;
      else if(!cursor.gaps.includes(cursor.url)) cursor.gaps.push(cursor.url);
    }
    let next: string | null = null;
    if(cursor.rechecking) next=cursor.gaps.shift()||null;
    else if (position(cursor.url) < cursor.lastPage) {const u=new URL(order(cursor.url));u.searchParams.set('page',String(position(cursor.url)+1));next=u.href;}
    if (!cursor.rechecking && !next && cursor.orders.length) {
      next = cursor.orders.shift()!; cursor.seenOrders.push(order(next));
      // Every advertised ordering retains the identical collection scope.
      // Remember its published numeric range when the next response loses links.
      cursor.lastPage = cursor.maxAdvertisedPage;
    }
    if(!cursor.rechecking && !next && cursor.gaps.length){cursor.rechecking=true;next=cursor.gaps.shift()!;}
    const warnings = cursor.unresolvedGap ? ['An advertised source page remained unreadable after bounded retries and a final recheck.'] : [];
    return {items: result.items, nextCursor: next ? {...cursor, url: next,...(cursor.rechecking?{checkpointKey:`${next}#final-gap-recheck`}:{})} as unknown as Json : null, expectedCount: expected, complete: !next, partial: !!cursor.unresolvedGap, empty, repeatedPageAllowed: true, label: result.title, warnings, diagnostics: [{strategy: 'TokyoMotion public listing and published sort windows', result: next ? (cursor.rechecking?'rechecking unavailable advertised pages':'pagination continues') : 'reachable pagination exhausted', count: result.items.length}]};
  },
  async enrich(items, ctx) {
    const v = items[0], r = await ctx.read(v.canonicalUrl), parsed = parseDetail(r.text, r.url);
    if (!parsed.is_video) return [{...v, enrichedAt: ctx.now}];
    const extra = fromLegacy(parsed, 'tokyomotion');
    const fields = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length)));
    return [{...v, ...fields, id: v.id, sourceVideoId: v.sourceVideoId, enrichedAt: ctx.now}];
  },
};
