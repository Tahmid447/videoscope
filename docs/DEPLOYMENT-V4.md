# Configuration and staged deployment

## Required YouTube setup

The one required provider credential for launch acceptance is `YOUTUBE_API_KEY`.
Create/select a Google Cloud project, enable **YouTube Data API v3**, and create
an API key restricted to that API. Keep it server-side; do not use browser referrer
restrictions for a Worker key. Follow the [official setup guide](https://developers.google.com/youtube/v3/getting-started).

For local validation, add the key to ignored `.dev.vars`:

```dotenv
YOUTUBE_API_KEY=your_key_here
```

Run the channel regression with the official API:

```sh
node --env-file=.dev.vars --import tsx scripts/live-v4.ts youtube
```

Store the same key as a Worker secret interactively (never in a command argument,
frontend asset, D1 row or Git commit):

```sh
npx wrangler secret put YOUTUBE_API_KEY --env preview
npx wrangler secret put YOUTUBE_API_KEY --env ""
```

YouTube API search is disabled by default. Set `YOUTUBE_SEARCH_ENABLED=true` only
when its quota cost and approximate index coverage are acceptable. Channel scans
use the uploads playlist with up to 50 IDs per page and batched video enrichment.
A cached collection avoids repeated enumeration; refreshed membership can reuse
recent metadata. API denials/quota exhaustion are explicit errors with saved progress.

## Optional Meta setup

Configure `META_ACCESS_TOKEN`, `META_GRAPH_VERSION` and `META_AUTHORIZED_SOURCES`
as Worker secrets. The mapping is a JSON array of `{url, objectId, kind}` entries,
where kind is `instagram` or `facebook`. These represent API-authorized Instagram
professional accounts or Facebook pages. `META_APP_ID` and `META_APP_SECRET` are
reserved for an eventual OAuth connection flow; this release does not use them.
No arbitrary public-profile scraping or login bypass is implemented. Validate
permissions and supported fields against the configured Meta Graph version before
enabling a live mapping. Mocked official payload tests run without credentials.

## Cloudflare resources

The Worker owns static assets and `/api/*`. D1 stores normalized metadata and
progress. Queues deliver one scan step at a time; a minute cron redelivers due
jobs when delivery is interrupted. No R2 or container is required for metadata.

`wrangler.jsonc` defines independent preview and production names/bindings.
The preview and production D1 databases and queues are provisioned independently.
The production database remains empty until the release gate passes.
Never point preview at the production database.

```sh
npx wrangler login --device --scopes user:read account:read workers:write workers_routes:write workers_scripts:write workers_tail:read zone:read pages:write d1:write queues:write
npx wrangler d1 create videoscope-v4-preview
npx wrangler queues create videoscope-v4-preview-scans
npx wrangler d1 create videoscope-v4-production
npx wrangler queues create videoscope-v4-scans
```

All four creation commands are already completed; do not create duplicates.
D1 IDs are resource identifiers, not credentials. Local OAuth authorization is
stored by Wrangler in the macOS keychain/encrypted config. It is not a GitHub
Actions credential. For CI deployment, configure a scoped Cloudflare API token in
GitHub environment secret `CLOUDFLARE_API_TOKEN` and account ID environment variable
`CLOUDFLARE_ACCOUNT_ID`. The token needs Worker script, D1 and Queue access to this
account. No account token is committed or copied into an artifact.

## Release gates

1. Work on the feature branch. Run `npm ci`, `npm run check`, and `npm run db:local`.
2. Run controlled live regressions locally. Inspect any partial result and the
   source's published pagination; a source count is never silently substituted.
3. Commit the verified code. Deploy a controlled preview, binding `BUILD_SHA` to
   `git rev-parse HEAD`. No automatic Cloudflare previews are configured.
4. Run hosted source/browser acceptance on that preview. The script verifies the
   reported build SHA before scanning. Production requires a successful
   `cloudflare-acceptance.yml` run for the exact release commit.
5. Only after all required checks pass, apply production migrations and deploy
   once through manual `cloudflare-release.yml` with target `production` and the
   successful acceptance run ID. Never use production to discover provider bugs.

A local authorized preview deployment is equivalent to the preview branch of
the manual workflow:

```sh
npm run check
npx wrangler d1 migrations apply DB --remote --env preview
npx wrangler deploy --env preview --var BUILD_SHA:$(git rev-parse HEAD)
SITE_URL=https://your-preview.workers.dev GITHUB_SHA=$(git rev-parse HEAD) node scripts/hosted-v4.mjs
```

The manual workflows become dispatchable after their definitions exist on the
repository default branch. Before that, push an explicit
`videoscope-preview-check-<unique-name>` tag at the deployed feature commit to run
the same controlled acceptance workflow. Set the repository variable
`VIDEOSCOPE_PREVIEW_URL` to the preview URL first. This creates a real Actions
acceptance run for the exact SHA without merging an unverified application into
main. Ordinary feature commits do not start live scans or deployments.

The hosted harness retains jobs and its device key under ignored `.wrangler/`,
with mode 0600. Rerunning against the same build continues saved jobs. For a new
build, choose another ignored `HOSTED_STATE_FILE`. Never upload that state file.
Reports under `artifacts/` contain results without the workspace credential.
Completed test collections are retained for inspection. Source-limited search
coverage can pass only with exhausted pagination, no terminal errors/unresolved
advertised pages, and an honest partial status. Other required sources must be
complete. Selected-source CLI runs are diagnostic; release runs check all sources.

When using local Wrangler OAuth for the first release, apply the same GitHub
acceptance gate before a single production deployment. Set `ACCEPTANCE_RUN` to
the successful controlled workflow's run ID:

```sh
GITHUB_REPOSITORY=Tahmid447/videoscope GITHUB_SHA=$(git rev-parse HEAD) ACCEPTANCE_RUN=YOUR_RUN_ID node scripts/release-gate.mjs
# Continue only if the gate above succeeds.
npx wrangler d1 migrations apply DB --remote --env ""
npx wrangler deploy --env "" --var BUILD_SHA:$(git rev-parse HEAD)
```

The local command uses existing `gh` authentication; no Cloudflare token needs
to be copied into GitHub for this route. The manual production workflow remains
available once on main and its GitHub environment credentials are configured.
No automatic production workflow runs on ordinary pushes or acceptance tags.

## Quotas and recovery

A scan has one provider/host lease and bounded retries. New scans have workspace
hourly/concurrent limits. One-page commits use JSON table inputs to fit D1's
100-parameter and 50-query free invocation budgets. Partial and complete records
are paginated in SQL; changing filters does not transfer all records to a browser.
Response caches expire automatically. Daily account quotas still apply; the free
plan is not unlimited. Monitor CPU, D1 rows read/written and Queue operations on
preview before choosing a paid plan. No paid plan is enabled automatically.
See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

Pause/cancel invalidates in-flight leases. Process restart/duplicate delivery
reuses persisted cursors and cannot overwrite newer user controls. Terminal
partial scans preserve collected records; enrichment can finish even when a later
listing page fails. Continue retries the saved failed cursor. A completed scan
can be refreshed or rescanned into a separate snapshot.

## Netlify migration and rollback

Current rollback URL: https://videoscope-3-tahmid.netlify.app.
Keep it deployed during preview acceptance. The feature branch's Netlify
`ignore = "exit 0"` prevents Git-triggered rebuilds; `build:legacy` and
`test:legacy` remain available for an explicitly chosen rollback build.

Cloudflare and Netlify have separate storage and browser origins. Existing v3
collections/bookmarks are not silently migrated. Export JSON from v3 and import
it into v4, or rescan the source. Source/provenance distinctions are preserved;
imported metadata cannot overwrite trusted provider records.

After successful acceptance, make the Cloudflare URL primary. If regressions
appear, return the public link/domain to the retained Netlify deployment. Do not
delete Cloudflare D1 while diagnosing; pause affected scans. For a Worker-only
rollback use `wrangler rollback` to a verified previous version. D1 restore/time
travel is a separate, deliberate data recovery action, not an automatic part of
code rollback. This release adds a fresh schema and does not modify Netlify data.
