# VideoScope recovery and continuation checkpoint

Updated 2026-09-20. The user asked to preserve work across an account/session
change, then authorized continuing the rebuild. This is an in-progress release
checkpoint, not production sign-off.

## Authoritative locations

- Repository: https://github.com/Tahmid447/videoscope
- Branch: `codex/videoscope-provider-engine-v4` (do not restart from main).
- Implemented and deployed source: `024d9eaa2cf06163593a272c9679be731cf68c82`.
- Its full CI passed: https://github.com/Tahmid447/videoscope/actions/runs/35512633080
- Preview: https://videoscope-v4-preview.tahmidhc245.workers.dev
- Preview Worker version: `08aa2117-b516-4a44-9cdb-3c358adc8717`.
- Existing production / rollback: https://videoscope-3-tahmid.netlify.app
- Original production base: `070a6ae9592b5fc788cf7ea3ea2f0fccce5b675f`.
- No v4 production deployment, production D1 migration, or main merge occurred.

The implementation is committed and pushed. Session interruption did not erase
it. Preview D1 continued its backend scan after the local acceptance runner lost
DNS resolution. The search finished with **1,145 unique records / 1,150 reported,
252 pages, 267 requests**, honestly marked **partial**, with no terminal errors.
All five source-published sort windows and the two final gap rechecks were read.
The reported source total is not treated as collected data.

## What exists

`engine/` defines nullable normalized records, modular providers, bounded public
network transport, a shared SQL filter, durable D1 storage, and a one-step job
runner. `cloudflare/worker.ts` owns the API, Queue consumer and recovery cron.
`web/` is the v4 UI, built to static `dist/`. Provider-specific pagination stays
inside adapters. D1 commits records and checkpoints together with lease/revision
fencing. Pause/cancel invalidates in-flight work. Filters run over all stored
records before pagination. The browser does not own scan execution.

Providers: official YouTube uploads/playlists/video API; TokyoMotion public
listings and published search sorts; generic JSON-LD, OpenGraph, oEmbed, scoped
RSS/Atom, WordPress REST/featured media and advertised video sitemaps; authorized
Meta Graph account/page mappings. Missing credentials produce explicit errors.
Downloads are hidden/unavailable. The separate media branch at `53af5cb` passed
21 backend tests but has no completed hosted attachment/playback acceptance.

Keep v3 `static/`, Netlify functions and legacy scanners as rollback. Only tested
metadata helpers in `lib/extract.mjs` are reused by v4. Read
[architecture inventory](ARCHITECTURE-INVENTORY.md),
[provider design](PROVIDER-ENGINE.md), [deployment](DEPLOYMENT-V4.md), and
[verification](VERIFICATION-V4.md) before changing the architecture.

## Verification already obtained

- CI at the implementation SHA passed lint, types, 51 legacy/core tests,
  16 provider/network tests, 10 D1 integration tests, five browser tests,
  static build, Worker dry-run and local D1 migration.
- Integration includes 1,146 records / 58 pages, all-collection filters,
  deduplication, actual runtime shutdown/restart, duplicate messages,
  pause/cancel fencing, partial enrichment/resume and bounded crash recovery.
- Desktop 1440 and mobile 375/390/430 passed locally.
- Actual hosted profile: 72 / 72, four pages, sorting/pagination/detail checks
  passed at desktop and all three mobile widths.
- Local live WordPress/RSS archive: 109 records, 12 feed reads, titles/dates/
  thumbnails present; unavailable metrics stay null.
- Previous local search: 1,144 / 1,150 over 250 pages. That run started before
  the final empty-page retry fix. The hosted search above uses the committed fix.
- `npm audit` reported zero known vulnerabilities.
- Captured preview runtime sample: 165 events, all outcome `ok`, maximum sampled
  CPU 253 ms. This is a sample, not a promise about all account quotas.

## Remaining work / release blockers

1. **YouTube key**: the user must supply `YOUTUBE_API_KEY` in ignored `.dev.vars`
   and/or Cloudflare Worker secret storage. No key is available in this checkpoint.
   Run the real channel enumeration and batch enrichment locally and on preview.
   Fixtures and a useful missing-key state do not replace this launch gate.
2. Recover hosted acceptance from the DNS interruption. Its prior report contains
   only YouTube blocked and profile passed. Complete hosted search filtering/UI,
   archive, and all live checks. Make the harness resilient and resumable without
   duplicating scans or deleting retained data on a network outage.
3. A source-reported shortfall after exhausting public pagination must remain
   partial. Validate honest coverage; never lower totals or invent missing IDs.
4. Inspect actual preview resource behavior. Resolve any failing required check
   before production. Optional Meta live tests need authorized credentials.
5. Provision separate production D1/Queue only at the release stage; its database
   ID in `wrangler.jsonc` is intentionally all zero. No paid plan was enabled.
6. Manual workflow definitions must exist on the default branch before dispatch.
   GitHub deployment also requires a scoped Cloudflare token in its environment;
   local Wrangler OAuth is not a GitHub Actions credential. Preserve the manual,
   exact-commit acceptance gate and avoid production-per-fix deployments.
7. Produce the full final verification table, provider capability matrix, exact
   SHA, migration version, remaining configuration, URLs and limitations.

## Cloud resources and credentials

- Cloudflare account: `e8f1eea5d1c73f3cbc307d71f0a98ca9`.
- Preview D1: `videoscope-v4-preview`, ID
  `6c0eb4da-2a3a-4b85-93d4-996b3a397e83`.
- Preview Queue: `videoscope-v4-preview-scans`; one message and consumer at a time.
- Migration: `0001_provider_engine.sql`.
- Worker: `videoscope-v4-preview`, minute recovery cron.
- Cloudflare OAuth was successfully authorized for D1 and Queues. A later remote
  D1 read/export succeeded. Old localhost callback error tabs are stale.
- Auth is in local Wrangler encrypted/keychain storage. Never copy it, API keys,
  browser workspace keys, raw tail request headers or `.dev.vars` into GitHub.
- Optional Meta secrets: `META_ACCESS_TOKEN`, `META_GRAPH_VERSION`,
  `META_AUTHORIZED_SOURCES`; currently unconfigured.

## Data recovery

The preview database remains in Cloudflare independently of this chat/account.
A SQL export was made after the recovered search finished, then restored into
an in-memory SQLite database to verify it. It contains 1,215 video rows (including
unreferenced records from the completed test profile), one retained collection
and 252 checkpoints. The retained collection contains 1,145 search records.

Local deliverable: `outputs/videoscope-preview-recovery.sql` in the parent task
directory. Keep this backup private: it includes source metadata, response cache
and hashed workspace owners. It is intentionally not in this public repository.
Do not import a full SQL backup over a live database. Use a fresh recovery DB.

The prior test workspace was recovered from its own local runtime evidence and
saved with mode 0600 in ignored `.wrangler/hosted-v4-state.json`. It grants access
only to this controlled test workspace and must never be committed. Existing
search scan: `c654ded4-8e5c-4ba4-9a0c-f16b40d57918`; collection:
`279929d1-01f3-492d-be6e-a814a879c0a8`. No user production collections were deleted.
Device workspace keys are browser-specific; changing browser origins does not
transfer them. Provider records can be exported/imported through the UI.

## Resume on another account or computer

```sh
git clone https://github.com/Tahmid447/videoscope.git
cd videoscope
git switch codex/videoscope-provider-engine-v4
npm ci
npx playwright install chromium
npm run check
```

On the original machine reuse the existing checkout instead of overwriting it:
`/Users/tahmidahmed/Documents/Codex/2026-09-20/files-pasted-by-the-user-you/work/videoscope`.
Read this file and inspect `git status` first. New machines need their own GitHub/
Cloudflare authorization. Do not reuse expired OAuth callback URLs. Inspect the
existing preview build SHA and resources before creating or deploying anything.
The source commit above is the deployed code; later documentation or harness
commits do not automatically change the running Worker.

Continue the original rebuild from its existing branch. Do not rebuild a second
application or merge the unfinished media branch just to enable a button. Keep
Netlify available. Deploy production only after every required gate passes.
