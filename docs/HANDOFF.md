# VideoScope continuation checkpoint

Updated 2026-09-20 UTC. **Not production sign-off.** The user chose to wait for
Cloudflare's free daily D1 quota reset, not upgrade. Continue after **2026-09-21
00:00 UTC / 09:00 Japan time**. A one-time continuation is scheduled in the current
Codex task for 09:05 Japan time; the computer and app must be running.

## Start here

- Repository: https://github.com/Tahmid447/videoscope
- Branch: `codex/videoscope-provider-engine-v4`; draft PR https://github.com/Tahmid447/videoscope/pull/6
- Original requirements: [PROJECT-BRIEF.md](PROJECT-BRIEF.md).
- Checkout: `/Users/tahmidahmed/Documents/Codex/2026-09-20/files-pasted-by-the-user-you/work/videoscope`.
- Latest source is this branch's HEAD. It includes the narrow-screen large-number
  fix and persistent CI workspace setup described below. Inspect `git status`.
- Preview currently runs **`1c888442a2d1b6baf7129de6db699a764f15cb12`**:
  https://videoscope-v4-preview.tahmidhc245.workers.dev
- Preview Worker version: `e0ac0b38-e066-4e71-8d34-5adb0030359b`.
- Existing production/rollback: https://videoscope-3-tahmid.netlify.app
- **No v4 production Worker deployment, production migration, or main merge.**

## What blocked the release

Cloudflare's runtime reported that this account exhausted its free daily D1 row
write limit. Reads still worked; progress remained in D1. The exact error is in
[evidence](evidence/2026-09-20/cloudflare-quota-blocker.json). Do not retry writes
repeatedly before reset, create duplicate databases, or upgrade billing.

Hosted acceptance run https://github.com/Tahmid447/videoscope/actions/runs/35514842775
was cancelled after this diagnosis to stop wasting runner time. Its artifacts
were downloaded and its incomplete report is preserved. **It did not pass.**

The report also caught 6px horizontal overflow at 375px: YouTube's total views
were 2,689,653,688. This branch fixes the stat typography and wraps very large
values. The existing browser fixture now includes a multi-billion view count;
all five browser tests passed after the fix at 1440/375/390/430. This corrected
CSS is not yet deployed to preview. Do not claim hosted YouTube UI has passed.

## Saved cloud work: reuse it

The cancelled run's controlled workspace was recovered privately and verified
against its saved search job. Local state is mode 0600, ignored:
`.wrangler/hosted-ci-1c88844.json`. Its credential is also in GitHub's encrypted
repository secret `VIDEOSCOPE_ACCEPTANCE_WORKSPACE`. The updated acceptance
workflow passes this as `HOSTED_WORKSPACE`; the harness reconciles collections
by source URL. New CI runners will reuse saved jobs rather than rescan YouTube.
A fresh runner repeats read-only filter/browser acceptance against the current
build; it does not treat the earlier failed report as success.

| Source | Saved scan ID | Actual state |
|---|---|---|
| YouTube | `cf21b0d5-b54b-4496-814c-c5d8d329f40f` | Complete 2,473/2,473; 50 pages; 2,473 enriched. Hosted API/filter assertions passed before the 375px UI overflow failure. |
| TokyoMotion profile | `cc2087ac-3700-4f8c-a9f5-843b801c78ef` | Hosted acceptance PASS: 72/72; 4 pages; filters and all four viewports. |
| TokyoMotion search | `d8a2b774-5d04-4574-8cf3-3d6bfd5fcce6` | Enumerating, paused by quota at 1,141/1,150; 237 pages. Cursor is fifth sort/page 38, with 17 earlier gaps queued for final rechecks. No terminal job errors yet. |
| WordPress/RSS archive | Not started in this workspace | Earlier preview passed 109 records/12 pages/109 enriched; final current-build acceptance still required. |

The backend recovery cron may resume search automatically once writes work. Do
not erase the job, lower source counts, bypass acceptance, or claim its coverage
is complete. Publicly unreachable items must remain an honest partial result.
The older search job `c654ded4-8e5c-4ba4-9a0c-f16b40d57918` completed partial
1,145/1,150 with 252 pages, but is not the current release acceptance.

## Next steps after reset

1. Check current branch CI once. Previous `1c88844` deterministic CI passed all
   85 tests plus lint/types/build/migration. The local fix passed all five browser
   tests. Do not repeat unrelated local checks; let normal CI validate the new HEAD.
2. With a clean worktree and passing CI, build assets (`npm run build`) and deploy
   **preview only** with `npx wrangler deploy --env preview --var BUILD_SHA:$(git rev-parse HEAD)`.
   Run Wrangler commands sequentially: parallel OAuth refresh caused a transient
   auth error previously. YouTube secret is already configured on preview.
3. Verify `/api/config` matches HEAD. Push an explicit unique
   `videoscope-preview-check-*` tag at that exact SHA. The workflow now uses the
   saved encrypted workspace secret and continues existing cloud collections.
   Repo variable `VIDEOSCOPE_PREVIEW_URL` is already set. Watch the actual run.
4. Allow remaining search and archive checks to finish. Download the final
   `cloudflare-preview-acceptance` artifact. All four rows must pass and
   `allRequiredPassed` must be true. Fix actual failures; never weaken gates.
5. Run `scripts/release-gate.mjs` with `GITHUB_REPOSITORY=Tahmid447/videoscope`,
   `GITHUB_SHA` equal to the deployed/tested HEAD, and `ACCEPTANCE_RUN` equal to
   the successful new run ID. The cancelled run cannot authorize production.
6. Only after that exact-SHA gate, migrate production and deploy once:
   `npx wrangler d1 migrations apply DB --remote --env ''`, then
   `npx wrangler deploy --env '' --var BUILD_SHA:THE_VERIFIED_SHA --secrets-file .dev.vars`.
   Wrangler supports `--secrets-file`; this installs YouTube on first production
   deploy without a temporary Worker. Never print or commit `.dev.vars`.
7. Verify production config and run the prepared limited
   `artifacts/production-smoke.mjs` with SITE_URL, GITHUB_SHA and one actual saved
   YouTube canonical URL as SMOKE_VIDEO_URL. This tests one real record, reload,
   details and four widths. It writes sanitized evidence and screenshots.
8. Update the verification table, capability matrix, primary URL and handoff.
   Commit sanitized final evidence. Make PR ready/merge only after required
   checks pass, keeping the feature branch for recovery. Keep Netlify rollback.
9. Export final databases sequentially, restore to temporary SQLite to verify,
   refresh Git bundle/checksum manifest in `../../outputs`, then deliver the
   final report. Do not overwrite live databases with SQL backups.

For local diagnostic continuation, select a fresh ignored HOSTED_STATE_FILE for
this new build, with HOSTED_WORKSPACE loaded privately from the recovered file.
Never pass workspace/API keys as CLI arguments, expose raw tail headers, or
upload `.wrangler/`. Local continuation alone does not satisfy the GitHub gate.

## Architecture and limitations

`engine/` contains nullable records, modular providers, public-only network
transport, whole-collection SQL filters, durable D1 storage and a one-step
runner. `cloudflare/worker.ts` serves assets/API, consumes Queue messages and
runs the recovery cron. D1 transactions save records/cursors together, fence
pause/cancel with leases/revisions, and recover duplicate/restarted work.
`web/` builds to `dist/`; legacy `static/`, scanners and Netlify functions are
rollback-only. See [provider design](PROVIDER-ENGINE.md),
[architecture inventory](ARCHITECTURE-INVENTORY.md),
[deployment](DEPLOYMENT-V4.md), and [verification](VERIFICATION-V4.md).

The user clarified that Facebook/Instagram means **arbitrary public profiles**.
That is **not supported** by this release. The Meta adapter is fixture-tested
for explicitly API-authorized page/professional-account mappings only; no Meta
credentials are configured. Do not ask the user for a managed account again or
promise any-link support. Generic websites work only through supported public
standards. Downloads remain unavailable; media branch `53af5cb` is isolated.
Unknown metrics remain null. YouTube search is disabled by default for quota.

## Resources and secrets

- Cloudflare account `e8f1eea5d1c73f3cbc307d71f0a98ca9`.
- Preview D1 `videoscope-v4-preview`: `6c0eb4da-2a3a-4b85-93d4-996b3a397e83`.
- Preview queue `videoscope-v4-preview-scans`.
- Production D1 `videoscope-v4-production`: `af53cb04-e6f8-4b76-81e2-d873574c5eeb` (empty).
- Production queue `videoscope-v4-scans`; intended Worker `videoscope-v4`.
- Expected future URL https://videoscope-v4.tahmidhc245.workers.dev (not deployed).
- Migration `0001_provider_engine.sql`; applied to preview only.
- Cloudflare D1/Queues authorization already succeeded. Ignore stale localhost
  callback tabs. Credentials are local encrypted Wrangler/keychain data.
- YOUTUBE_API_KEY works, lives in ignored mode-0600 `.dev.vars`, and is installed
  on preview. No further user YouTube setup is needed. Scan 2,473/2,473 passed.
- No paid plan authorized. Optional Meta settings remain unconfigured.

## Durable recovery

The latest private SQL backup is `../../outputs/videoscope-preview-recovery-final.sql`.
It was restored into temporary SQLite: **3,797 video rows, six collections,
six scan jobs, 559 checkpoints**. It includes saved metadata/cache/hashed owners,
so stays off this public GitHub repository. Earlier backup is also retained.
The private recovered workspace file grants access to these controlled CI
collections. Browser keys are device-specific; changing accounts/origins does
not automatically transfer user collections. JSON export/import is available.

`../../outputs/videoscope-source-recovery.bundle` contains all saved Git refs;
`../../outputs/SHA256SUMS.txt` verifies recovery artifacts. Another account can
clone GitHub, switch to the feature branch, and read this checkpoint. Reuse this
checkout on the original computer. New computers need their own GitHub and
Cloudflare login; never copy OAuth secrets into GitHub. Work is preserved even
if the scheduled desktop continuation cannot run.
