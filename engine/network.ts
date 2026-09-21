import ipaddr from 'ipaddr.js';
import { resolve4, resolve6 } from 'node:dns/promises';
import robotsParser from 'robots-parser';
import { ProviderError, retryAfter } from './errors.ts';
import type { ReadOptions, ReadResult, Diagnostic } from './model.ts';

export function publicAddress(value: string): boolean {
  try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; }
}
export function publicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ProviderError('invalid_url', 'Enter a complete public HTTP or HTTPS URL.', 400); }
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.href.length > 4096 || (u.port && !['80', '443'].includes(u.port))) throw new ProviderError('invalid_url', 'Only public HTTP/HTTPS addresses on standard ports are supported.', 400);
  if (!h.includes('.') && !h.includes(':') || /(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(h) || h.endsWith('.home.arpa') || (ipaddr.isValid(h) && !publicAddress(h))) throw new ProviderError('private_address', 'Private, local and reserved addresses cannot be scanned.', 400);
  u.hash = '';
  return u;
}
export async function resolvePublic(host: string): Promise<void> {
  const name = host.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(name)) { if (!publicAddress(name)) throw new ProviderError('private_address', 'Private address blocked.'); return; }
  const responses = await Promise.allSettled([resolve4(name), resolve6(name)]);
  const ips = responses.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (!ips.length) throw new ProviderError('dns_failure', 'Source DNS did not return public addresses.', 502, true);
  if (ips.some(x => !publicAddress(x))) throw new ProviderError('private_address', 'Source DNS includes a private or reserved address.');
}
export interface TransportOptions {
  fetcher?: typeof fetch; resolve?: (host: string) => Promise<void>; onRequest?: (d: Diagnostic) => void;
  getCache?: (key: string) => Promise<ReadResult | null>; putCache?: (key: string, r: ReadResult) => Promise<void>;
  delayMs?: number;
}
const officialHosts = new Set(['www.googleapis.com', 'graph.facebook.com', 'graph.instagram.com']);
export function transport(options: TransportOptions = {}) {
  const fetcher = options.fetcher || fetch, resolve = options.resolve || resolvePublic;
  const robots = new Map<string, string>();
  let lastRequest = 0;
  async function rawRead(raw: string, opts: ReadOptions = {}, checkRedirectRobots = true): Promise<ReadResult> {
    let u = publicUrl(raw);
    if (opts.official && !officialHosts.has(u.hostname)) throw new ProviderError('credential_origin', 'Credential requests must use an official API origin.');
    const cacheable = opts.cache !== false && !opts.headers && !u.searchParams.has('key') && !u.searchParams.has('access_token');
    const cached = cacheable ? await options.getCache?.(u.href) : null;
    if (cached) return cached;
    for (let hop = 0; hop < 5; hop++) {
      await resolve(u.hostname);
      const delay = (options.delayMs || 0) - (Date.now() - lastRequest);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      const started = Date.now(); lastRequest = started;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetcher(u.href, {redirect: 'manual', signal: controller.signal, headers: {
          'user-agent': 'VideoScope/4.0 PublicMetadataReader', accept: 'text/html,application/json,application/rss+xml,application/atom+xml,application/xml;q=0.9', ...opts.headers,
        }});
        options.onRequest?.({strategy: opts.official ? 'official API request' : 'public metadata request', result: u.hostname, status: response.status, durationMs: Date.now() - started});
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          if (opts.headers || opts.official) throw new ProviderError('api_redirect', 'An official API unexpectedly redirected; credentials were not forwarded.');
          const target = response.headers.get('location');
          if (!target) throw new ProviderError('bad_redirect', 'Source supplied an empty redirect.');
          u = publicUrl(new URL(target, u).href);
          if(checkRedirectRobots) await checkRobots(u);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError(`http_${response.status}`, `Source returned HTTP ${response.status}${response.status === 403 ? ' (access denied or API quota/authorization unavailable)' : ''}.`, response.status, response.status === 429 || response.status >= 500, retryAfter(response.headers.get('retry-after')));
        }
        if (Number(response.headers.get('content-length')) > 4_000_000) { await response.body?.cancel(); throw new ProviderError('response_limit', 'Source metadata exceeded the 4 MB response limit.'); }
        const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
        if (reader) for (;;) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 4_000_000) { await reader.cancel(); throw new ProviderError('response_limit', 'Source metadata exceeded the 4 MB response limit.'); }
          chunks.push(value);
        }
        const body = new Uint8Array(size); let offset = 0; for (const c of chunks) { body.set(c, offset); offset += c.length; }
        const result = {url: u.href, status: response.status, headers: response.headers, text: new TextDecoder().decode(body)};
        if (cacheable) await options.putCache?.(raw, result);
        return result;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('network_failure', controller.signal.aborted ? 'Source request timed out.' : 'Source connection failed.', 502, true);
      } finally { clearTimeout(timer); }
    }
    throw new ProviderError('redirect_limit', 'Source redirected too many times.');
  }
  async function checkRobots(u: URL) {
    if (u.pathname !== '/robots.txt') {
      if (!robots.has(u.origin)) {
        try { robots.set(u.origin, (await rawRead(`${u.origin}/robots.txt`,{},false)).text); }
        catch (error) {
          if (error instanceof ProviderError && error.status === 404) robots.set(u.origin, '');
          else throw new ProviderError('robots_unavailable', 'Source crawl instructions could not be read; scanning is deferred.', 503, true, 60_000);
        }
      }
      if (robotsParser(`${u.origin}/robots.txt`, robots.get(u.origin) || '').isAllowed(u.href, 'VideoScope') === false) throw new ProviderError('robots_denied', 'Source crawl instructions disallow automated reads of this URL.', 403);
    }
  }
  return async (url: string, opts: ReadOptions = {}): Promise<ReadResult> => {
    const u = publicUrl(url);
    if (!opts.official) await checkRobots(u);
    return rawRead(url, opts);
  };
}
