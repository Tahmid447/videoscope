import { record, knownNumber, type Provider, type Credentials, type ProviderContext, type Detection, type Json, type VideoRecord } from '../model.ts';
import { ProviderError } from '../errors.ts';
import { durationOf } from '../../lib/extract.mjs';
interface Snippet { title?: string; description?: string; channelTitle?: string; channelId?: string; videoOwnerChannelTitle?: string; videoOwnerChannelId?: string; publishedAt?: string; tags?: string[]; thumbnails?: Record<string, { url: string }>; resourceId?: {videoId?: string}; }
interface Item { id?: string | {videoId?: string}; snippet?: Snippet; contentDetails?: {relatedPlaylists?: {uploads?: string}; videoId?: string; videoPublishedAt?: string; duration?: string; definition?: string}; statistics?: {viewCount?: string; likeCount?: string; commentCount?: string}; status?: {privacyStatus?: string; uploadStatus?: string}; }
interface ApiPage { items?: Item[]; pageInfo?: {totalResults?: number}; nextPageToken?: string; error?: unknown; }
interface Cursor { playlist?: string; token?: string; channel?: string; }
const capabilities = (env: Credentials) => ({ id: 'youtube', name: 'YouTube', sourceTypes: ['video', 'channel', 'playlist', 'search'] as Detection['sourceType'][], metrics: ['title', 'thumbnail', 'publishedAt', 'views', 'likes', 'comments', 'durationSeconds', 'uploader', 'isHD'], enumeration: true as const, credential: 'YOUTUBE_API_KEY', configured: !!env.YOUTUBE_API_KEY, download: false as const, note: 'Official Data API. Search requires YOUTUBE_SEARCH_ENABLED and reports search-index coverage, not all YouTube videos.', delayMs: 250, cacheTtlSeconds: 3600, enrichmentBatch: 50 });
function detection(u: URL): Detection | null {
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (!['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return null;
  let sourceType: Detection['sourceType'] = 'other', url = u.href;
  const videoId = host === 'youtu.be' ? u.pathname.split('/')[1] : u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
  if (videoId) { sourceType = 'video'; url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`; }
  else if (u.pathname === '/playlist' && u.searchParams.get('list')) { sourceType = 'playlist'; url = `https://www.youtube.com/playlist?list=${encodeURIComponent(u.searchParams.get('list')!)}`; }
  else if (/^\/(?:@[^/]+|channel\/[^/]+|user\/[^/]+)(?:\/(?:videos|shorts|streams))?\/?$/.test(u.pathname)) { sourceType = 'channel'; url = `https://www.youtube.com${u.pathname.replace(/\/(videos|shorts|streams)\/?$/, '').replace(/\/$/, '')}/videos`; }
  else if (u.pathname === '/results' && u.searchParams.has('search_query')) { sourceType = 'search'; url = `https://www.youtube.com/results?search_query=${encodeURIComponent(u.searchParams.get('search_query')!)}`; }
  return {provider: 'youtube', sourceType, url};
}
async function api(path: string, params: Record<string, string>, ctx: ProviderContext): Promise<ApiPage> {
  if (!ctx.env.YOUTUBE_API_KEY) throw new ProviderError('credential_missing', 'YouTube detected. YouTube API not configured. Add YOUTUBE_API_KEY to the backend environment.');
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k,v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const response = await ctx.read(u.href, {official: true, headers: {'x-goog-api-key': ctx.env.YOUTUBE_API_KEY}, cache: false});
  const data = JSON.parse(response.text) as ApiPage;
  if (!Array.isArray(data.items) || data.error) throw new ProviderError('extraction_failed', 'YouTube API returned an unexpected response, not an empty collection.');
  return data;
}
export function youtubeRecord(item: Item, enriched = false): VideoRecord | null {
  const s = item.snippet || {}, id = enriched ? item.id : item.contentDetails?.videoId || s.resourceId?.videoId || (typeof item.id === 'object' ? item.id.videoId : item.id);
  if (typeof id !== 'string' || !id) return null;
  const thumbs = s.thumbnails || {}, publishedAt = enriched ? s.publishedAt : item.contentDetails?.videoPublishedAt || (typeof item.id === 'object' ? s.publishedAt : null);
  return record('youtube', id, `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, {
    title: s.title || 'Unavailable video', description: s.description || null,
    thumbnailUrl: (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default)?.url || null,
    uploader: s.videoOwnerChannelTitle || s.channelTitle || null, uploaderId: s.videoOwnerChannelId || s.channelId || null, uploaderUrl: s.videoOwnerChannelId || s.channelId ? `https://www.youtube.com/channel/${s.videoOwnerChannelId || s.channelId}` : null,
    publishedAt: publishedAt || null, datePrecision: publishedAt ? 'timestamp' : 'unavailable',
    views: knownNumber(item.statistics?.viewCount), likes: knownNumber(item.statistics?.likeCount), comments: knownNumber(item.statistics?.commentCount),
    durationSeconds: durationOf(item.contentDetails?.duration), isHD: item.contentDetails?.definition ? item.contentDetails.definition === 'hd' : null,
    quality: item.contentDetails?.definition || null, tags: s.tags || [], availability: item.status?.privacyStatus || 'public API metadata',
    metadataSources: {listing: enriched ? 'YouTube videos.list' : 'YouTube playlistItems.list/search.list'}, enrichedAt: enriched ? new Date().toISOString() : null,
  });
}
export const youtube: Provider = {
  id: 'youtube', detect: detection, capabilities,
  async enumerate(source, raw, ctx) {
    if (!ctx.env.YOUTUBE_API_KEY) throw new ProviderError('credential_missing', 'YouTube detected. YouTube API not configured. Add YOUTUBE_API_KEY to the backend environment.');
    const u = new URL(source.url), cursor = (raw || {}) as Cursor;
    if (source.sourceType === 'video') {
      const data = await api('videos', {part: 'snippet,contentDetails,statistics,status', id: u.searchParams.get('v')!}, ctx);
      const items = data.items!.map(x => youtubeRecord(x, true)).filter((x): x is VideoRecord => !!x);
      if (!items.length) throw new ProviderError('video_unavailable', 'YouTube does not expose this video to the configured API.');
      return {items, nextCursor: null, complete: true, expectedCount: 1, label: items[0].title};
    }
    if (source.sourceType === 'other') throw new ProviderError('unsupported_source', 'Use a YouTube @handle, channel ID, uploads URL, playlist or ordinary video URL.');
    if (source.sourceType === 'search') {
      if (ctx.env.YOUTUBE_SEARCH_ENABLED !== 'true') throw new ProviderError('search_configuration', 'YouTube search requires YOUTUBE_SEARCH_ENABLED=true and available Search Queries quota. Channel uploads do not require search.');
      const data = await api('search', {part: 'snippet', q: u.searchParams.get('search_query')!, type: 'video', maxResults: '50', pageToken: cursor.token || ''}, ctx);
      return {items: data.items!.map(x => youtubeRecord(x)).filter((x): x is VideoRecord => !!x), nextCursor: data.nextPageToken ? {token: data.nextPageToken} : null, complete: !data.nextPageToken, partial: true, expectedCount: knownNumber(data.pageInfo?.totalResults), warnings: ['Search totals are approximate. Results cover the publicly reachable API search index only.'], diagnostics: [{strategy: 'YouTube search.list', result: data.nextPageToken ? 'next page token' : 'search pagination exhausted'}]};
    }
    let playlist = cursor.playlist || u.searchParams.get('list'), channel = cursor.channel;
    if (!playlist) {
      const path = u.pathname.split('/').filter(Boolean);
      const filter: Record<string,string> = path[0].startsWith('@') ? {forHandle: decodeURIComponent(path[0])} : path[0] === 'user' ? {forUsername: path[1]} : {id: path[1]};
      const data = await api('channels', {part: 'contentDetails,snippet', ...filter}, ctx);
      const item = data.items![0]; playlist = item?.contentDetails?.relatedPlaylists?.uploads || null;
      channel = item?.snippet?.title;
      if (!playlist) throw new ProviderError('channel_unavailable', 'The YouTube API did not expose an uploads playlist for this channel.');
    }
    const data = await api('playlistItems', {part: 'snippet,contentDetails,status', playlistId: playlist, maxResults: '50', pageToken: cursor.token || ''}, ctx);
    return {
      items: data.items!.map(x => youtubeRecord(x)).filter((x): x is VideoRecord => !!x),
      nextCursor: data.nextPageToken ? {playlist, token: data.nextPageToken, channel: channel || ''} as Json : null,
      expectedCount: knownNumber(data.pageInfo?.totalResults), complete: !data.nextPageToken,
      empty: data.items!.length === 0 && !data.nextPageToken, label: channel || 'YouTube playlist',
      diagnostics: [{strategy: 'YouTube playlistItems.list', result: data.nextPageToken ? 'next page token' : 'playlist exhausted', count: data.items!.length}],
    };
  },
  async enrich(items, ctx) {
    const data = await api('videos', {part: 'snippet,contentDetails,statistics,status', id: items.map(x => x.sourceVideoId).join(',')}, ctx);
    const values = new Map(data.items!.map(x => youtubeRecord(x, true)).filter((x): x is VideoRecord => !!x).map(x => [x.id, x]));
    return items.map(x => values.has(x.id) ? {...x, ...values.get(x.id)!} : {...x, availability: 'not exposed by videos.list', enrichedAt: ctx.now});
  },
};
