# VideoScope release and recovery checkpoint

Updated September 23, 2026. **The supported v4 release is deployed.** This replaces
all older pending-release/quota-reset instructions. Facebook/Instagram public
profile support and platform downloads remain unfinished capabilities, not
completed release features. Do not restart completed scans or redeploy this build.

## Released version

- Production: https://videoscope-v4.tahmidhc245.workers.dev
- Preview: https://videoscope-v4-preview.tahmidhc245.workers.dev
- Both run source `73fb62e721638a2d8bc0cda0e3682d2965d34a7b`.
- Production Worker version: `7070a22f-3729-4bbc-8e84-5b943dcd7770`.
- Preview Worker version: `903f8b16-8d51-4b58-9fc4-660765bd4316`.
- Migration `0001_provider_engine.sql` is applied in both databases.
- Exact-source acceptance passed: https://github.com/Tahmid447/videoscope/actions/runs/35569097461
- PR https://github.com/Tahmid447/videoscope/pull/6 merged into main at
  `ae25408939edf6a35aeab9619fbdbf85ef679d21` on September 21.
- Production was deployed once after the release gate. Later documentation-only
  commits do not change the deployed application or require new scans.
- September 23 read-only audit confirmed production still reports this source,
  YouTube configured and Meta unconfigured. GitHub confirms the successful run
  and merged PR. One read of the saved production job confirmed its complete
  one-record result and zero errors. No long acceptance or live scans were repeated.

## Completed and verified

The pause/claim race was fixed with an atomic returned job snapshot and a fenced
provider lock. The narrow-screen large-view-count overflow was also fixed.
89 deterministic tests, lint, typecheck, build, migration checks and final hosted
acceptance passed. See [full verification](VERIFICATION-V4.md) and
[sanitized release evidence](evidence/2026-09-21/).

| Source | Saved result | Coverage |
|---|---|---|
| YouTube | 2,473/2,473; 50 pages | Complete |
| TokyoMotion profile | 72/72; four pages | Complete |
| TokyoMotion search | 1,147/1,150; 267 pages | Partial; reachable pagination exhausted, no terminal errors |
| WordPress/RSS archive | 109 records; 12 pages | Complete public feed/archive |

All four hosted collections passed whole-collection sorting, filtering, search,
paging and details checks at 1440, 375, 390 and 430px. Unknown metrics stay null.
Production smoke verified a real YouTube video, reload persistence and all four
widths. Actual direct MP4 downloads passed in preview and production: 1,128,375
bytes, editable filename, attachment response, FFprobe and Chromium playback.

## Remaining capability limits and next work

- Arbitrary Facebook/Instagram public profiles are **not supported**. The Meta
  adapter has fixture coverage only and no configured credentials. It currently
  reads explicitly mapped, API-authorized Pages/professional accounts.
- The user wants arbitrary profiles, not just accounts they manage. Do not claim
  that adding a token solves that requirement. On September 23, requested one
  public example URL per platform. Both supplied Reels pages show an initial
  public listing in the browser. This does not prove complete backend/API access.
  The user confirmed their own linked Instagram professional account and Page,
  signed in, registered as a developer and created VideoScope. App ID:
  `2254262295147290`. Login configuration `VideoScope Read Access`, ID
  `1085883213805922`, uses a user token and four scopes: `instagram_basic`,
  `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`.
  Graph API Explorer is on v26.0 with that configuration selected. It awaits the
  user's Generate Access Token / account authorization step. No token has been
  installed in VideoScope or live Meta API result verified. Do not recreate the
  app, repeat registration or ask whether the accounts are linked. Next: verify
  one small managed-Page/linked-account response, then one Business Discovery
  response for the supplied Instagram username. See [Meta setup](META-SETUP.md).
- Instagram Business Discovery may offer limited access to other professional
  accounts; it is not implemented here and is not access to consumer profiles.
  Any extension requires a suitable authorized connection and a bounded real
  response check before claiming support.
- Downloads work for public unencrypted direct `.mp4` URLs up to 16 MB only,
  with twelve downloads/hour/workspace. YouTube and other platform page links,
  HLS/DASH, larger files and transcoding remain unavailable. A separate media
  service is not deployed; no paid hosting is authorized.
- Generic websites require supported public metadata/feeds. There is no
  universal any-link guarantee. YouTube API search is disabled for quota control.
- Existing Netlify data is not automatically migrated. Browser workspaces are
  device/origin-specific; use JSON export/import when moving between hosts.

The old quota-reset heartbeat is now **paused** because its release work is
complete. Do not schedule further scans or repeatedly rerun acceptance merely
because a new session starts. For an actual code change, run focused relevant
checks, then the required release gate before another production release.

## Resources and secrets

- Cloudflare account: `e8f1eea5d1c73f3cbc307d71f0a98ca9`.
- Preview D1: `videoscope-v4-preview`, `6c0eb4da-2a3a-4b85-93d4-996b3a397e83`.
- Preview queue: `videoscope-v4-preview-scans`.
- Production D1: `videoscope-v4-production`, `af53cb04-e6f8-4b76-81e2-d873574c5eeb`.
- Production queue: `videoscope-v4-scans`; Worker: `videoscope-v4`.
- YouTube key is configured in both Workers and ignored mode-0600 `.dev.vars`.
  No new YouTube key or Cloudflare authorization is needed for this release.
- Optional `META_ACCESS_TOKEN`, `META_GRAPH_VERSION`, `META_AUTHORIZED_SOURCES`
  remain unconfigured. Never paste tokens into chat or commit them.
- Private CI workspace: ignored `.wrangler/hosted-ci-1c88844.json` and encrypted
  GitHub secret `VIDEOSCOPE_ACCEPTANCE_WORKSPACE`. Reuse saved jobs if needed.
- Private production smoke workspace: ignored `.wrangler/production-smoke.json`.
- Stay on the free Cloudflare plan. Daily quotas still apply. No upgrade or paid
  service was enabled; saved work survived the September 20 quota interruption.

## Durable recovery

Repository: https://github.com/Tahmid447/videoscope. Main contains the merged
implementation. Retain `codex/videoscope-provider-engine-v4` and the release tag
`videoscope-preview-check-73fb62e-20260921`. Check `git status` before new work.
Original requirements remain in [PROJECT-BRIEF.md](PROJECT-BRIEF.md).

Checkout on this computer:
`/Users/tahmidahmed/Documents/Codex/2026-09-20/files-pasted-by-the-user-you/work/videoscope`.
Recovery artifacts are in `../../outputs` relative to this checkout:

| Private backup taken September 21 | Videos | Collections | Jobs | Checkpoints |
|---|---:|---:|---:|---:|
| videoscope-preview-final.sql | 3,800 | 11 | 11 | 602 |
| videoscope-production-final.sql | 2 | 2 | 2 | 2 |

Both SQL exports were restored into temporary SQLite and checked. They are
mode-0600 local backups, not public GitHub files. These are dated snapshots;
later user scans remain in live D1. Never overwrite live databases with a backup
as part of routine continuation. Earlier snapshots are retained.

`videoscope-source-recovery.bundle` backs up Git refs. `SHA256SUMS.txt` records
recovery artifact checksums. `VIDEOSCOPE-VERIFICATION.md` contains results and
`VIDEOSCOPE-RECOVERY.md` mirrors this handoff. `verified-download.mp4` is the
actual public sample saved by the production browser check.

Changing ChatGPT accounts does not erase GitHub or D1. Reuse this checkout on
the same computer, or clone GitHub elsewhere and read this handoff. Another
computer needs its own GitHub/Cloudflare login. Never copy OAuth credentials to
GitHub. Keep private SQL/workspace files private.

Netlify rollback remains https://videoscope-3-tahmid.netlify.app. Legacy code is
retained and Netlify automatic builds remain disabled. Architecture and future
release procedures are documented in [DEPLOYMENT-V4.md](DEPLOYMENT-V4.md).
