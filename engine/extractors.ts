import { load } from 'cheerio/slim';
import { createHash } from 'node:crypto';
import { parseListing, parseDetail as legacyDetail, parseFeed, parseWordPressPostMeta, durationOf, dateOf } from '../lib/extract.mjs';
import { record, knownNumber, type VideoRecord } from './model.ts';

// Boundary for the source-faithful parsers retained from the production release.
export function fromLegacy(v: Record<string, any>, provider: string): VideoRecord {
  const sourceId = provider === 'tokyomotion' ? new URL(v.url).pathname.match(/^\/video\/(\d+)/)?.[1] || v.id : v.id;
  return record(provider, sourceId, v.url, {
    title: v.title, description: v.description || null, thumbnailUrl: v.thumbnail_url || null,
    uploader: v.creator || null, publishedAt: v.published_at ? new Date(v.published_at).toISOString() : null,
    relativePublishedText: v.date_precision === 'approximate' ? v.date_raw : null, datePrecision: v.date_precision,
    views: v.views ?? null, likes: v.likes ?? null, dislikes: v.dislikes ?? null, comments: v.comments_count ?? null,
    rating: v.rating ?? null, ratingCount: v.rating_count ?? null, ratingScale: v.rating_best ?? null,
    durationSeconds: v.duration_seconds ?? null, isHD: v.is_hd ?? null, tags: v.tags || [],
    availability: v.availability || 'public metadata', metadataSources: Object.fromEntries(Object.entries(v.field_sources || {}).filter(([, value]) => typeof value === 'string')) as Record<string, string>,
    fetchedAt: v.fetched_at, enrichedAt: v.detail_fetched_at || null,
  });
}
export { parseListing, parseWordPressPostMeta };
export function parseDetail(html: string, url: string): Record<string, any> { return legacyDetail(html, url); }
export function htmlRecords(html: string, url: string, provider = 'generic'): { items: VideoRecord[]; candidates: string[]; next: string | null; title: string; expected: number | null; strategy: string } {
  const parsed = parseListing(html, url), detail = !parsed.items.length && !parsed.candidates.length ? parseDetail(html, url) : null;
  const items = detail?.is_video ? [detail] : parsed.items;
  return {items: items.map((v: Record<string, any>) => fromLegacy(v, provider)), candidates: parsed.candidates.map((v: {url: string}) => v.url), next: parsed.next, title: parsed.title, expected: parsed.expected, strategy: detail?.is_video ? 'JSON-LD / OpenGraph / video element' : parsed.kind};
}
export function feedRecords(xml: string, url: string) {
  const $ = load(xml, {xmlMode: true});
  const valid = $('rss,feed,rdf\\:RDF').length > 0;
  // Recognize video enclosures even if neither title nor description says "video".
  $('item,entry').each((_, el) => {
    if ($(el).find('enclosure[type^="video/"],media\\:content[type^="video/"]').length && !$(el).find('description').text()) $(el).append('<description>Video enclosure</description>');
  });
  const parsed = parseFeed($.xml(), url);
  const next = $('feed > link[rel="next"],channel > atom\\:link[rel="next"],channel > link[rel="next"]').first().attr('href');
  const u = new URL(url), wordpress = /https?:\/\/wordpress\.org\//i.test($('generator').text()) && (/\/feed\/?$/.test(u.pathname) || u.searchParams.has('feed'));
  let nextUrl = next ? new URL(next, url).href : null;
  if (!nextUrl && wordpress && $('item,entry').length) { u.searchParams.set('paged', String(Number(u.searchParams.get('paged') || 1) + 1)); nextUrl = u.href; }
  return {valid, entries: $('item,entry').length, items: parsed.items.map((v: Record<string, any>) => fromLegacy(v, 'wordpress-rss')), next: nextUrl, inferredWordPressPage: wordpress && !next && !!nextUrl, title: parsed.title, bounded: !wordpress && !nextUrl};
}
export function oembedRecord(data: Record<string, unknown>, url: string): VideoRecord | null {
  if (data.type !== 'video' || typeof data.title !== 'string') return null;
  return record('generic', createHash('sha256').update(url).digest('hex').slice(0,24), url, {
    title: data.title, thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
    uploader: typeof data.author_name === 'string' ? data.author_name : null,
    uploaderUrl: typeof data.author_url === 'string' ? data.author_url : null,
    // oEmbed width/height describe the embed, not necessarily the actual video resolution.
    metadataSources: {listing: 'oEmbed'},
  });
}
export function wordpressRecords(data: any[], base: string): VideoRecord[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap(post => {
    const html = `${post.content?.rendered || ''}${post.excerpt?.rendered || ''}`;
    const $ = load(html);
    if (!post.link || !post.title?.rendered || !$('video,iframe,embed,object').length && !/\bvideo\b/i.test(post.format || '')) return [];
    return [record('wordpress-rss', createHash('sha256').update(post.link).digest('hex').slice(0,24), post.link, {
      title: load(post.title.rendered).text(), description: $.text().trim() || null,
      thumbnailUrl: parseWordPressPostMeta(post, base)?.thumbnail_url || null,
      uploader: post._embedded?.author?.[0]?.name || null, uploaderId: post.author == null ? null : String(post.author),
      publishedAt: post.date_gmt ? new Date(`${post.date_gmt.replace(/Z$/, '')}Z`).toISOString() : null,
      datePrecision: post.date_gmt ? 'timestamp' : 'unavailable', metadataSources: {listing: 'WordPress REST API'},
      categories: (post._embedded?.['wp:term'] || []).flat().map((term: {name?: string}) => term.name).filter(Boolean),
    })];
  });
}
export function sitemapRecords(xml: string, base: string) {
  const $ = load(xml, {xmlMode: true});
  const records: VideoRecord[] = [];
  $('url').each((_, el) => {
    const n = $(el), v = n.find('video\\:video').first(), href = n.children('loc').text().trim(), title = v.find('video\\:title').text().trim();
    if (!href || !title) return;
    const u = new URL(href, base).href;
    records.push(record('generic', createHash('sha256').update(u).digest('hex').slice(0,24), u, {
      title, thumbnailUrl: v.find('video\\:thumbnail_loc').text().trim() || null, description: v.find('video\\:description').text().trim() || null,
      durationSeconds: durationOf(v.find('video\\:duration').text()), views: knownNumber(v.find('video\\:view_count').text()),
      publishedAt: dateOf(v.find('video\\:publication_date').text()).published_at,
      metadataSources: {listing: 'public video sitemap'},
    }));
  });
  return {items: records, sitemaps: $('sitemap > loc').map((_,el) => $(el).text().trim()).get(), valid: $('sitemapindex,urlset').length > 0};
}
