# VideoScope v4 verification

Production: https://videoscope-v4.tahmidhc245.workers.dev

Preview: https://videoscope-v4-preview.tahmidhc245.workers.dev

Deployed source: `73fb62e721638a2d8bc0cda0e3682d2965d34a7b`. Database migration: `0001_provider_engine.sql`.

Required acceptance: https://github.com/Tahmid447/videoscope/actions/runs/35569097461

| Feature | Provider/Test | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| YouTube channel enumeration | Official API / hosted | Exhaust uploads | 2473/2473; 50 pages | PASS |
| YouTube enrichment | Official videos.list | Preserve available fields | 2473 views; 2472 durations; 2456 likes; 2403 comments | PASS |
| TokyoMotion profile | Hosted source | Complete public listing | 72/72; 4 pages | PASS |
| TokyoMotion search | All public sort windows | Exhaust reachable pagination; report gaps | 1147/1150; 267 pages; partial | PASS honest partial coverage |
| WordPress/RSS archive | Hosted scoped feed | Enumerate and enrich | 109 entries; 12 pages | PASS |
| Generic JSON-LD / OG / oEmbed / Atom | Provider fixtures | Verified standards metadata | Fixtures pass; absent fields remain null | PASS |
| Collection persistence | D1 restart / duplicate delivery | Keep saved cursor and records | 1,146 records over 58 pages, restart and recovery tests | PASS |
| Pause/resume/cancel | D1 race regression + browser | Prevent stale writes and lost leases | Atomic claim and provider fence; actual race reproduced and fixed | PASS |
| Deduplication | D1 / hosted collection paging | Unique memberships | Unique IDs verified across stored pages | PASS |
| Most/least viewed | Full SQL / all hosted collections | Correct ordering; unknowns last | Both directions and all pages verified | PASS |
| Newest/oldest | Full SQL / hosted | UTC date ordering | Both directions; opposite timezone regression | PASS |
| Min/max views | SQL / hosted | Exact qualifying IDs | Ranges and null exclusion verified | PASS |
| Date range | SQL / hosted | Inclusive selected final day | Exact qualifying IDs verified | PASS |
| Duration range | SQL / hosted | Exact qualifying IDs | Ranges and unknown exclusion verified | PASS |
| Title/uploader search | SQL / hosted | Search full collection | Verified on all four source collections | PASS |
| Viewport 1440px | Playwright local / hosted | Usable cards, details, paging; no overflow | All four source collections passed | PASS |
| Viewport 375px | Playwright local / hosted | Usable cards, details, paging; no overflow | All four source collections passed | PASS |
| Viewport 390px | Playwright local / hosted | Usable cards, details, paging; no overflow | All four source collections passed | PASS |
| Viewport 430px | Playwright local / hosted | Usable cards, details, paging; no overflow | All four source collections passed | PASS |
| MP4 download E2E | Preview + production; MDN CC0 sample | Save real playable attachment | 1128375 bytes; editable filename; FFprobe + Chromium playback | PASS (direct MP4 only) |
| Cloudflare production | Post-deployment smoke | Expected SHA, real scan, persistence and UI | Version 4.0.0; one real YouTube item; four viewports | PASS |
| Arbitrary Facebook/Instagram profiles | Requested capability | Collect arbitrary public profiles | Not supported by the authorized Meta adapter | NOT SUPPORTED |
| Platform/HLS/DASH downloads | Requested download expansion | Download platform-page media | Separate media service not deployed; buttons remain unavailable | NOT SUPPORTED |

## Provider capabilities

| Provider | Supported collection | Download | Configuration |
|---|---|---|---|
| YouTube | Public channel uploads, playlists and videos | Unavailable | YOUTUBE_API_KEY configured |
| TokyoMotion | Supported public profiles, listings, categories and search sorts | Unavailable | None |
| WordPress/RSS/Atom | Public scoped feeds and supported REST archives | Unavailable | None |
| Generic standards | Verified JSON-LD, OG, oEmbed, HTML cards and video sitemap entries | Unavailable | None |
| Direct MP4 | Public, unencrypted .mp4 URLs up to 16 MB | Real validated attachment; twelve downloads/hour/workspace | None |
| Meta | Authorized page/professional-account mappings; fixtures only | Unavailable | Optional META_ACCESS_TOKEN, META_GRAPH_VERSION, META_AUTHORIZED_SOURCES; not configured |

## Validation and limits

The release passed 89 deterministic tests (51 legacy/core, 18 provider/network/media, 13 D1 integration, two acceptance-client, five browser), lint, typecheck, builds, migrations and hosted acceptance. A local browser export timeout passed on its targeted rerun; the final GitHub acceptance independently passed the full suite.

No required YouTube setup remains. YouTube search is disabled by default for quota control. The free Cloudflare account has daily limits; its September 20 D1 quota interruption preserved data and scans resumed after reset. No paid plan was enabled.

Arbitrary Facebook/Instagram public profiles and universal website support are not implemented. Only direct MP4 files up to 16 MB have media downloads; YouTube/platform pages, larger files, HLS/DASH and transcoding need a separately hosted media service. Unknown source metrics remain null. The search collection honestly reports 1147/1150, not fabricated completeness. Relative source dates remain approximate.

Browser workspace keys are device-specific. Existing Netlify collections are not automatically moved; use JSON export/import. The Netlify rollback remains https://videoscope-3-tahmid.netlify.app. Backups and continuation instructions are in VIDEOSCOPE-RECOVERY.md.
