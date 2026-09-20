import { record, knownNumber, type Provider, type Detection, type VideoRecord } from '../model.ts';
import { ProviderError } from '../errors.ts';
interface Authorization {url: string; objectId: string; kind: 'instagram' | 'facebook';}
export const meta: Provider = {
  id: 'meta',
  detect(u) {
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (!['facebook.com', 'instagram.com', 'fb.watch'].includes(host)) return null;
    const sourceType: Detection['sourceType'] = /\/(?:reel|reels|p|watch|videos)\//.test(u.pathname) || host === 'fb.watch' ? 'video' : 'profile';
    return {provider: 'meta', url: u.href, sourceType};
  },
  capabilities(env) { return {id: 'meta', name: 'Facebook / Instagram', sourceTypes: ['profile','video','collection'], metrics: ['title','thumbnail','publishedAt','likes','comments'], enumeration: 'conditional', credential: 'META_ACCESS_TOKEN + META_AUTHORIZED_SOURCES + META_GRAPH_VERSION', configured: !!(env.META_ACCESS_TOKEN && env.META_AUTHORIZED_SOURCES && env.META_GRAPH_VERSION), download: false, note: 'Only explicitly mapped accounts/pages authorized for the configured official Graph API token. Arbitrary public URLs cannot be enumerated.', delayMs: 1000, cacheTtlSeconds: 900, enrichmentBatch: 0}; },
  async enumerate(source, raw, ctx) {
    const env = ctx.env;
    if (!env.META_ACCESS_TOKEN || !env.META_AUTHORIZED_SOURCES || !env.META_GRAPH_VERSION) throw new ProviderError('credential_missing', 'Meta provider detected. Collection enumeration requires authorized Meta API configuration: META_ACCESS_TOKEN, META_AUTHORIZED_SOURCES and META_GRAPH_VERSION.');
    if (!/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION)) throw new ProviderError('configuration_invalid', 'META_GRAPH_VERSION must be a supported Graph API version such as vNN.0.');
    let mappings: Authorization[];
    try { mappings = JSON.parse(env.META_AUTHORIZED_SOURCES); if (!Array.isArray(mappings)) throw new Error(); } catch { throw new ProviderError('configuration_invalid', 'META_AUTHORIZED_SOURCES must be an array of authorized URL/objectId/kind mappings.'); }
    const normalize = (s: string) => { const u = new URL(s); u.hostname = u.hostname.replace(/^(www|m)\./, ''); u.pathname = u.pathname.replace(/\/$/, ''); u.hash = ''; u.search = ''; return u.href; };
    const authorization = mappings.find(x => normalize(x.url) === normalize(source.url));
    if (!authorization || !/^\d+$/.test(authorization.objectId) || !['instagram','facebook'].includes(authorization.kind)) throw new ProviderError('authorization_required', 'This URL is not an explicitly authorized Meta account or page. An arbitrary public profile cannot be enumerated with the current connection.');
    const cursor = raw as {after?: string} | null, instagram = authorization.kind === 'instagram';
    const u = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${authorization.objectId}/${instagram ? 'media' : 'videos'}`);
    u.searchParams.set('fields', instagram ? 'id,caption,media_type,permalink,thumbnail_url,timestamp,username,like_count,comments_count' : 'id,title,description,permalink_url,created_time,length,picture');
    u.searchParams.set('limit', '50'); if (cursor?.after) u.searchParams.set('after', cursor.after);
    const r = await ctx.read(u.href, {official: true, cache: false, headers: {Authorization: `Bearer ${env.META_ACCESS_TOKEN}`}}), data = JSON.parse(r.text);
    if (!Array.isArray(data.data) || data.error) throw new ProviderError('authorization_failed', 'Meta Graph API did not expose the requested authorized collection.');
    const items: VideoRecord[] = data.data.filter((x: any) => !instagram || x.media_type === 'VIDEO').map((x: any) => record('meta', `${authorization.kind}:${x.id}`, x.permalink || (x.permalink_url ? new URL(x.permalink_url, 'https://www.facebook.com').href : `https://www.facebook.com/${x.id}`), {
      title: x.title || x.caption?.split('\n')[0] || 'Untitled video', description: x.description || x.caption || null,
      thumbnailUrl: x.thumbnail_url || x.picture || null, uploader: x.username || null, uploaderId: authorization.objectId,
      publishedAt: x.timestamp || x.created_time || null, datePrecision: 'timestamp', durationSeconds: knownNumber(x.length), likes: knownNumber(x.like_count), comments: knownNumber(x.comments_count), metadataSources: {listing: 'authorized Meta Graph API'},
    }));
    const after = data.paging?.next ? data.paging?.cursors?.after : null;
    if (data.paging?.next && !after) throw new ProviderError('pagination_failed', 'Meta supplied a next page without a safe continuation cursor.');
    return {items, nextCursor: after ? {after} : null, complete: !after, empty: items.length === 0, diagnostics: [{strategy: 'authorized Meta Graph API', result: after ? 'next cursor' : 'authorized collection exhausted', count: items.length}]};
  },
};
