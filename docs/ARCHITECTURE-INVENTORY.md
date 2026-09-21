# VideoScope architecture inventory — 2026-09-20

Inspected before implementation, starting at production `main` commit
`070a6ae9592b5fc788cf7ea3ea2f0fccce5b675f`.

## Existing behavior and evidence

The production site is https://videoscope-3-tahmid.netlify.app. PRs 1–5 are merged;
there are no open PRs at inspection. Historical reports document profile 72/72,
search 1,146/1,146 across 250 page positions and four alternative public sort
orders, and RSS archive featured images. Those reports are historical evidence,
not substitutes for current acceptance tests.

1. **Working/reusable:** `lib/extract.mjs` has card-scoped parsing, VideoObject,
   OpenGraph, video elements, RSS/Atom, WordPress featured media, nullable metrics,
   date precision and URL identities. `lib/search-orders.mjs` preserves the search
   scope while discovering published alternate orderings. The dark/light static
   UI has details, device bookmarks, CSV, and paginated cards. `lib/network.mjs`
   validates public DNS, pins connections, rechecks redirects and bounds bodies.
2. **Brittle:** Netlify Blobs stores each entire collection as one JSON object.
   Browser POST `/api/scans/:id/step` drives every page; a closed browser stops
   work. Job and collection writes are separate, without atomic leases. Every
   result refresh downloads the full collection, and filters run in the browser.
   Global 1,000-page and 5,000-record limits contradict full enumeration. Feed
   pagination guesses a ten-entry page size. The README still says 3.3 while the
   app is 3.7. CI mixes deterministic checks with live third-party dependencies.
3. **Provider-specific:** TokyoMotion's numeric video IDs, profile creator,
   `.well` search cards, and `o` sort-window reconciliation are embedded in the
   generic extraction/scanning path. YouTube has no official provider; channel
   HTML goes through those parsers. No Meta adapter or credentials contract exists.
4. **Reuse:** Preserve the production rollback intact. Reuse tested metadata
   parsers behind normalized adapter boundaries and the visual identity. Reuse
   public search scope logic inside TokyoMotion only. Retain historical fixtures
   and regression tests. Introduce shared SQL filtering for all new providers.
5. **Replace:** Browser-owned scanning with D1 checkpoints and backend tasks;
   monolithic JSON with indexed records and memberships; implicit host scraping
   with capabilities and extraction diagnostics; arbitrary collection caps with
   provider cursors and honest partial states; remote-link download buttons with
   explicit unavailable capabilities until attachment E2E is verified.
6. **Deprecate after verification:** v3 scanner/API remain rollback-only; they
   must never be selected unpredictably from the v4 gateway. Old repair scripts
   are historical tools, not v4 build dependencies. Do not delete rollback code
   until production migration acceptance passes.

## Branch/history review

- `fix/verified-video-metadata`: genuine cards, SSRF protection and source details.
- `fix/archive-site-support-v34`: public RSS fallback.
- `fix/download-first-v35`: remote file links marketed as downloads, not an
  attachment pipeline; these controls must not be copied to v4.
- `fix/archive-thumbnails-v36`: public REST featured images.
- `fix/search-complete-v37`, `test/search-public-order-coverage`: real search
  cards, retry/gap handling and source-published alternate orders; keep semantics.
- `feat/real-media-downloads`: old 3.6 base; merging wholesale would remove 3.7
  search fixes.
- `fix/providers-and-downloads-v4` at `53af5cb`: materialized FastAPI service,
  yt-dlp subprocess/egress proxy, FFmpeg/FFprobe, direct/HLS/DASH attachments,
  signed tickets and Railway Docker configuration. Collection progress is disk
  JSON with restart/resume by re-enumeration, not a persistent cursor/database.
  It is not an official YouTube API implementation. Review/run its tests in an
  isolated checkout; do not merge its alternate scanner or enable downloads
  without separate deployed end-to-end verification.

## Deployment review

`netlify.toml` serves `static`, bundles `netlify/functions/api.mts`, and runs build
plus unit tests. Main is linked to Netlify; PRs historically cause previews.
There is no Cloudflare configuration or database migration on main or the media
branch. `railway.toml`/`Dockerfile.media` exist only in the unfinished media branch.
Production release verification currently triggers *after* a push to main.
V4 will instead use an explicit manual release with checks before deployment,
separate preview/production D1 databases, and no automatic per-commit hosting.

## V4 target

Keep JavaScript/TypeScript and the existing static styling. Add a Worker API,
D1 storage, provider adapters, safe bounded metadata transport, server-side
filtering and paginated responses. Backend scan tasks checkpoint one provider
page or metadata batch at a time; durable state is authoritative. A scheduled
recovery sweep covers lost task delivery. Worker CPU is reserved for metadata;
media processing stays on an optional, separately verified container service.

Test results, fresh live reproduction, and migration gates are recorded in
`docs/VERIFICATION-V4.md` as they are actually run.
