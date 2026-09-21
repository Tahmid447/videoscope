# Provider engine

The public API selects a registered adapter with `detect()`; source-specific
code never enters the scheduler or SQL filtering engine. `engine/model.ts`
defines VideoRecord, ScanJob, capabilities and the provider contract.

`enumerate(source, cursor, context)` returns one page of normalized records, an
opaque JSON continuation, completeness evidence, expected count and diagnostic
attempts. `enrich(records, context)` optionally obtains more metadata after IDs
have been enumerated. Add a provider under `engine/providers`, register it in
`index.ts`, and add network-free fixtures and pagination/error contract tests.
Never branch on a particular username, video title or search phrase.

## Lifecycle and durability

POST `/api/scans` creates a collection and job in D1 and enqueues its ID. It does
not read provider pages. The Queue consumer leases the job and provider/host,
reads one page or detail batch and commits records, memberships, checkpoint and
next cursor in a single D1 batch. Every statement is fenced by the lease and
revision. Pause/cancel invalidates the lease, so in-flight writes cannot undo the
user's action. Queue duplicate delivery cannot acquire an already leased job.

GET `/api/scans/:id` is read-only; browsers poll and may close at any point.
POST `/pause`, `/resume`, `/cancel` act on durable state. A cron sweep re-enqueues
due jobs after failed sends, message expiry, crashes or missed deliveries. D1
is authoritative; message delivery is an optimization. No arbitrary page/item
limits are used. Explicit request/storage/provider limitations are failures or
partial states, never a successful complete collection.

Transient HTTP 429, 5xx, timeouts and connection failures keep the cursor and
use bounded exponential backoff with jitter and Retry-After. Authorization,
invalid URLs and unsupported sources do not retry blindly. Relative dates retain
the source phrase and approximate precision. Unknown values are null, including
unknown counts; zero is a known count.

## Data and queries

Migration `0001_provider_engine.sql` creates indexed videos, collections,
collection_videos, scan_jobs, scan_checkpoints, providers, provider_locks,
response_cache, rate_buckets and bookmarks. Secrets live in Worker secrets,
never D1. Device bearer keys are hashed before storage and scope every collection
and bookmark query; they are not multi-device user accounts.

GET `/api/collections/:id/videos` filters before LIMIT/OFFSET and returns only
24, 48 or 96 records. Every provider uses `engine/filter.ts`. Numeric/date filters
exclude unknown values; both ascending and descending sorts put nulls last and
use a stable ID tie-breaker. Ratings are compared as a percentage only when their
source maximum is known. Requested resolution requires an actual known video
height; oEmbed player dimensions and thumbnail dimensions are not a resolution.

`cached` reuses a recent same-workspace collection. `refresh` enumerates current
membership and reuses fresh public metadata/response caches. `full` bypasses the
response/enrichment cache and creates a separate collection. Source membership
must still be enumerated to discover deletions; there is no provider-independent
change feed. Duplicate membership writes are suppressed where possible.

## Providers

| Adapter | Collection interface | Enrichment | Limitations |
|---|---|---|---|
| YouTube | Official channel resolution → uploads playlist; playlists, videos, optional API search | videos.list batches up to 50 | Requires backend key. Search index totals are approximate; search is opt-in. No downloads. |
| TokyoMotion | Public profile/search/category cards and advertised pagination; same-scope published sort windows | Public detail metadata | Source caps, inaccessible pages and relative dates remain explicit. No downloads. |
| WordPress/RSS | Scoped public RSS/Atom and REST; public featured media | Post featured image | Site-wide feeds cannot substitute for a taxonomy archive. A recent-only feed without history is partial. |
| Generic | JSON-LD VideoObject, OpenGraph, oEmbed, HTML cards/candidates, explicitly advertised video sitemap | Available common metadata | Standards-compatible sources only; no browser rendering or arbitrary JS API reverse engineering. |
| Meta | Official Graph account/page media cursor, restricted to server-configured URL/object mappings | Exposed fields only | Authorized professional Instagram accounts/Facebook pages, not arbitrary personal profiles. Credentials, API version and mapping required. |

## Transport and costs

The Worker transport validates scheme, credentials-in-URL, ports, private and
reserved IP ranges, A/AAAA answers and every redirect. Credentials are sent only
to exact official API hosts and never forwarded through redirects. Bodies are
streamed with a 4 MB decoded limit; source crawl instructions are respected.
The Cloudflare deployment uses public Internet fetch only and has no private
network/VPC bindings. Workers fetch is not a DNS-pinned Node socket; do not move
this transport into a privileged/private network without a pinned egress layer.
The v3 Node pinned-DNS transport remains available in the rollback code.

One provider/host lease limits concurrent scan pages; each adapter has a request
delay and cache TTL. New scans have per-workspace hourly and concurrent limits.
D1 and Queue free quotas still apply to the entire Cloudflare account. Measure
preview CPU and D1 row usage before raising concurrency. No R2, media processing,
Chromium or containers are needed for the collection engine.

## Media branch

`fix/providers-and-downloads-v4` at `53af5cb` contains the optional FastAPI,
FFmpeg/FFprobe and HLS/DASH attachment service. Its 21 backend tests passed in an
isolated checkout during this rebuild. It is not merged or connected to v4.
A container adapter must verify actual attachment bytes and playback on the
chosen deployed host before any download capability/button is enabled.

## Rollback boundaries

`static/`, `lib/scan-engine.mjs`, `lib/scanner.mjs`, `lib/search-orders.mjs`,
`netlify/functions/`, and older repair scripts are the v3 rollback implementation.
Only the tested source metadata helpers in `lib/extract.mjs` are reused by v4.
The v4 build uses `web/`, `engine/`, and `cloudflare/`; it never chooses the v3
scanner at runtime. Dead rollback code is retained until production acceptance.

## Direct MP4 attachments

The `direct-mp4` provider accepts public MP4 URLs up to 16 MB. It validates MIME,
complete MP4 boxes, a video track, and absence of protected-track markers before
saving a download capability. `/api/downloads` verifies collection ownership,
re-fetches and validates the complete file, then returns a real attachment. It
does not redirect the user to a remote URL. User-imported capability claims are
ignored. Downloads have a twelve-per-workspace hourly budget and no credentials
or cookies are sent to source hosts. Public IP/DNS, redirect and robots checks
apply. Hosted acceptance verifies the browser-saved bytes with FFprobe and real
Chromium playback. The supported workflow needs no FFmpeg on Cloudflare; platform
extraction, manifests, larger files and transcoding still require the separate
media service.
