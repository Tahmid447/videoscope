export type SourceType = 'video' | 'profile' | 'channel' | 'search' | 'category' | 'playlist' | 'collection' | 'other';
export type State = 'queued' | 'enumerating' | 'enriching' | 'complete' | 'partial' | 'paused' | 'failed' | 'cancelled';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface VideoRecord {
  id: string; provider: string; sourceHost: string; sourceVideoId: string;
  canonicalUrl: string; title: string; description: string | null; thumbnailUrl: string | null;
  uploader: string | null; uploaderId: string | null; uploaderUrl: string | null;
  publishedAt: string | null; relativePublishedText: string | null; datePrecision: string;
  views: number | null; likes: number | null; dislikes: number | null; comments: number | null;
  rating: number | null; ratingCount: number | null; ratingScale: number | null;
  durationSeconds: number | null; width: number | null; height: number | null;
  quality: string | null; isHD: boolean | null; tags: string[]; categories: string[];
  availability: string; downloadCapability: 'unavailable' | 'direct-mp4'; metadataSources: Record<string, string>;
  fetchedAt: string; enrichedAt: string | null;
}
export interface Capabilities {
  id: string; name: string; sourceTypes: SourceType[]; metrics: string[];
  enumeration: boolean | 'conditional'; credential: string | null; configured: boolean;
  download: false | 'conditional'; note: string; delayMs: number; cacheTtlSeconds: number; enrichmentBatch: number;
}
export interface Detection { provider: string; url: string; sourceType: SourceType; }
export interface Diagnostic { strategy: string; result: string; count?: number; status?: number; durationMs?: number; }
export interface Page {
  items: VideoRecord[]; nextCursor: Json; expectedCount?: number | null; label?: string;
  complete: boolean; partial?: boolean; empty?: boolean; repeatedPageAllowed?: boolean; warnings?: string[]; diagnostics?: Diagnostic[];
}
export interface Credentials {
  YOUTUBE_API_KEY?: string; YOUTUBE_SEARCH_ENABLED?: string;
  META_ACCESS_TOKEN?: string; META_APP_ID?: string; META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string; META_AUTHORIZED_SOURCES?: string;
}
export interface ReadResult { url: string; text: string; status: number; headers: Headers; }
export interface ReadOptions { headers?: Record<string, string>; official?: boolean; cache?: boolean; }
export interface ProviderContext {
  env: Credentials; retryAttempt: number; read(url: string, options?: ReadOptions): Promise<ReadResult>;
  seen(cursor: Json): Promise<boolean>; collected: number; expected: number | null; now: string;
}
export interface Provider {
  id: string; detect(url: URL): Detection | null;
  capabilities(env: Credentials): Capabilities;
  enumerate(source: Detection, cursor: Json, ctx: ProviderContext): Promise<Page>;
  enrich?(items: VideoRecord[], ctx: ProviderContext): Promise<VideoRecord[]>;
}
export interface ScanJob {
  id: string; collectionId: string; owner: string; inputUrl: string; provider: string; sourceType: SourceType;
  scanMode: string; status: State; phase: 'enumerating' | 'enriching'; currentCursor: Json; nextCursor: Json;
  expectedCount: number | null; uniqueItemsCollected: number; pagesRead: number; requestsMade: number; itemsReceived?: number;
  revision: number; lease: string | null; leaseUntil: number; nextRunAt: number; retries: number; recoveryAttempts?: number;
  enrichedCount: number; enrichedAfter: string; enrichment: boolean; enumerationInterrupted?: boolean;
  partial: boolean; complete: boolean; failed: boolean; paused: boolean;
  startedAt: string; updatedAt: string; finishedAt: string | null;
  warnings: string[]; errors: {code: string; message: string}[]; diagnostics: Diagnostic[];
  metadataCoverage: Record<string, number>; providerCapabilities: Capabilities; strategy: string;
}
export const activeStates = ['queued', 'enumerating', 'enriching'];
export const knownNumber = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function utcDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time=Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function record(provider: string, sourceVideoId: string, url: string, values: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: `${provider}:${sourceVideoId}`, provider, sourceHost: new URL(url).hostname.replace(/^www\./, ''), sourceVideoId,
    canonicalUrl: url, title: '', description: null, thumbnailUrl: null, uploader: null, uploaderId: null, uploaderUrl: null,
    relativePublishedText: null, datePrecision: 'unavailable', views: null, likes: null,
    dislikes: null, comments: null, rating: null, ratingCount: null, ratingScale: null, durationSeconds: null,
    width: null, height: null, quality: null, isHD: null, tags: [], categories: [], availability: 'public metadata',
    downloadCapability: 'unavailable', metadataSources: {}, fetchedAt: new Date().toISOString(), enrichedAt: null, ...values,
    publishedAt: utcDate(values.publishedAt),
  };
}
