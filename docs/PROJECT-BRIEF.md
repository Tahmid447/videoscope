# Original user project brief

Preserved project requirements, supplied by the repository owner. Later progress and release status are in HANDOFF.md.

You are taking over an EXISTING production software project called VideoScope.

You have access to my GitHub account.

Repository:
https://github.com/Tahmid447/videoscope

DO NOT start by creating an unrelated new application.

DO NOT apply another one-off fix for one URL.

DO NOT assume the latest deployed version is correct just because the UI loads.

The current production version identifies itself as VideoScope 3.7 and has accumulated multiple provider-specific fixes. Some features work for certain sources, while other completely normal public URLs return zero results.

Your job is to turn the existing project into the architecture VideoScope should have had from the beginning.

============================================================
0. THE MOST IMPORTANT INSTRUCTION
============================================================

The problem is NOT:

"Make this YouTube URL work."

The problem is:

"Build VideoScope so a new supported website/source does not require rewriting the application every time."

I want a general-purpose PUBLIC VIDEO COLLECTION DISCOVERY AND FILTERING PLATFORM.

The core workflow is:

URL / profile / channel / search / category / collection
        ↓
Detect provider/source type
        ↓
Enumerate the entire publicly reachable collection
        ↓
Normalize metadata into one VideoScope schema
        ↓
Persist collection + progress
        ↓
Display thumbnails/results progressively
        ↓
Allow powerful filtering/sorting over THE WHOLE COLLECTION
        ↓
Optionally enrich individual videos with additional metadata
        ↓
Optionally offer download only for providers where real download support
is implemented and verified

Do not build another collection of URL-specific patches.

============================================================
1. FIRST: INSPECT EVERYTHING THAT ALREADY EXISTS
============================================================

Clone and inspect:

Tahmid447/videoscope

Start with the default production branch.

Then inspect:

- git history
- open/closed pull requests
- feature/fix branches
- Netlify configuration
- Cloudflare-related files if any
- Railway/media backend code if any
- static frontend
- API/functions
- scanner
- parsers
- provider code
- tests
- workflows
- README/deployment documentation
- unfinished VideoScope v4/media branches
- previous 3.5/3.6/3.7 changes

DO NOT delete working functionality simply because you prefer another stack.

Create a written architecture inventory first:

1. what currently works
2. what is brittle
3. what is provider-specific
4. what can be reused
5. what should be replaced
6. what should be deprecated

Then create a NEW FEATURE BRANCH.

Do not make experimental changes directly to main.

Suggested branch:

codex/videoscope-provider-engine-v4

============================================================
2. CURRENT FAILING EXAMPLES / REGRESSION SOURCES
============================================================

These are regression examples, NOT the only websites VideoScope should support.

A. YouTube channel:

https://www.youtube.com/@FilmiIndian/videos

Current production behavior:
0 videos / 0 pages.

This is incorrect.

B. TokyoMotion profile:

https://www.tokyomotion.net/user/yua_xx/videos

This has previously worked and MUST NOT regress.

C. TokyoMotion search:

https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos

The source has previously reported roughly 1,000+ results.
The architecture must be capable of traversing the complete publicly
reachable result set, not arbitrarily stop at 5 or 25 pages.

D. InternetChicks archive:

https://internetchicks.com/actress/lillian-phillips/

Previous development discovered that ordinary HTML access may be blocked
while the site's public RSS/WordPress metadata surfaces usable titles,
dates and thumbnails.

That kind of fallback should be a GENERIC capability, not hardcoded to
one actress URL.

These URLs are TEST CASES.

Do not write logic like:

if URL contains "FilmiIndian"
if URL contains "lillian-phillips"
if search term == "エステ"

Provider rules may recognize HOSTS and URL TYPES.
They must never recognize specific users/search phrases as implementation logic.

============================================================
3. VIDEO COLLECTION MODEL
============================================================

Create one normalized internal VideoRecord model.

At minimum support:

id
provider
sourceHost
sourceVideoId
canonicalUrl

title
description
thumbnailUrl

uploader
uploaderId
uploaderUrl

publishedAt
relativePublishedText

views
likes
dislikes
comments
rating
ratingCount

durationSeconds

width
height
quality
isHD

tags/categories

availability

downloadCapability

metadataSources
fetchedAt

Use nullable fields correctly.

VERY IMPORTANT:

Unknown metrics are NOT zero.

If views are not available:

views = null

NOT:

views = 0

The UI must distinguish:

0 views

from:

views unavailable

============================================================
4. COLLECTION MODEL
============================================================

Create a persistent Collection/ScanJob model.

Store things such as:

collectionId
inputUrl
provider
sourceType

expectedCount
uniqueItemsCollected

pagesRead
requestsMade

complete
partial
failed
paused

currentCursor
nextCursor

startedAt
updatedAt
finishedAt

warnings
errors

metadataCoverage

providerCapabilities

scan strategy

Do NOT keep long collection scans only in the browser.

Reloading the webpage must NOT destroy progress.

A scan for 1,146 items may take time.

That is acceptable.

Correctness is more important than pretending to be instant.

============================================================
5. PROVIDER ARCHITECTURE
============================================================

Build a modular provider system.

Conceptually:

providers/
    base
    youtube
    tokyomotion
    wordpress-rss
    generic-jsonld
    generic-oembed
    generic-html
    meta
    ...

Use a common provider contract.

For example:

detect(url)
normalizeUrl(url)
getCollectionInfo(url)
enumerateCollection(url, cursor)
getVideoDetails(video)
getCapabilities()
getNextCursor()
getExpectedCount()

The exact interface can differ if you have a better design.

Each adapter should answer:

Can I handle this URL?

Is this:

video
profile
channel
search
category
playlist
collection
other

How do I enumerate videos?

How do I know when enumeration is complete?

Which metrics can I obtain?

Which metrics cannot I obtain?

Does this provider require an API credential?

============================================================
6. NEVER AGAIN RETURN EMPTY RESULTS JUST BECAUSE ONE PARSER FAILED
============================================================

Build an extraction strategy pipeline.

For an unknown/public source, attempt appropriate strategies such as:

1. official provider API
2. provider public endpoint
3. oEmbed discovery
4. JSON-LD VideoObject
5. OpenGraph
6. RSS
7. Atom
8. WordPress REST API
9. public sitemap
10. static HTML collection cards
11. source-specific public pagination
12. optional rendered-page adapter when technically appropriate and permitted

Do not silently fall from:

parser failed

to:

0 videos

Instead report:

Provider: YouTube
Strategy attempted: YouTube API
Result: credential missing

or:

Provider: Generic HTML
Cards detected: 0
RSS found: yes
10 entries retrieved

or:

Source reports 1,146 items
Reachable through this source interface: 1,000
Coverage: partial

The application must distinguish:

EMPTY COLLECTION

from:

EXTRACTION FAILED

from:

PARTIAL COLLECTION

from:

UNSUPPORTED SOURCE

============================================================
7. YOUTUBE SUPPORT — THIS MUST BE A REAL PROVIDER
============================================================

Do not scrape arbitrary HTML selectors and call YouTube supported.

Implement YouTube as a first-class provider.

Prefer the official YouTube Data API.

Use server-side environment configuration such as:

YOUTUBE_API_KEY

Never expose the API key to frontend JavaScript.

Support at minimum:

youtube.com/@handle/videos

youtube.com/channel/.../videos

youtube.com/playlist?list=...

ordinary video URLs

YouTube search URLs where technically appropriate

For CHANNEL uploads:

Resolve the handle/channel.

Determine the uploads playlist.

Enumerate playlist pages until the playlist is exhausted.

Retrieve video metadata in batches.

Collect, where the API makes them available:

title
thumbnail
publish date
duration
uploader/channel
views
likes
comments
video ID
canonical URL

Continue using page tokens until finished.

Do not stop after the first 50.

For large channels, collection enumeration and metadata enrichment should
be separate stages.

If the channel has thousands of videos:

enumerate all IDs first

then enrich in batches/background jobs.

The UI should begin displaying results progressively.

If YOUTUBE_API_KEY is not configured, VideoScope should say exactly that.

It must NOT say:

"0 videos."

Add setup documentation for obtaining/configuring the API key.

Respect provider quotas.

Cache results.

============================================================
8. FACEBOOK / INSTAGRAM / META ARCHITECTURE
============================================================

I may later paste:

Facebook profiles/pages/videos

Instagram profiles/Reels

Do NOT solve this by scraping private/login-only pages or bypassing authentication.

Create a real Meta provider architecture.

Use official Meta/Instagram Graph APIs where access and permissions allow it.

Support public data that the configured credentials are authorized to retrieve.

Environment/config support might include:

META_ACCESS_TOKEN
META_APP_ID
META_APP_SECRET

Do not expose credentials to frontend code.

If an arbitrary public Instagram/Facebook URL cannot be enumerated using
available authorized APIs, VideoScope should provide an honest provider
capability result rather than fake 0 records.

Example:

Instagram provider detected
Collection enumeration requires Meta API authorization
Connection not configured

The important architectural goal is that adding/configuring Meta support
does NOT require modifying VideoScope's core collection/filtering system.

============================================================
9. TOKYOMOTION AND SIMILAR HTML PROVIDERS
============================================================

Keep working TokyoMotion behavior.

But separate it into its own provider module.

Support:

profile listings
search-result listings
category listings if available
pagination

Handle:

different card layouts
duplicate records
empty intermediate pages
source result caps
source pagination caps

If the source has multiple legitimate public sort orders and one ordering
caps results, a provider may union/deduplicate publicly reachable sort
windows when appropriate.

Do NOT place TokyoMotion-specific pagination logic into the generic scanner.

Provider-specific logic belongs in the provider.

============================================================
10. GENERIC WORDPRESS / RSS SUPPORT
============================================================

The InternetChicks work demonstrated an important generic pattern.

A page may block server-side HTML while still exposing:

RSS
Atom
WordPress REST API
featured media

Turn this into a WordPress/RSS provider.

If RSS entries expose:

title
URL
publication date
author
categories

and WordPress API exposes:

featured image

combine them into one VideoRecord.

Do not hardcode any particular site/person.

============================================================
11. GENERIC VIDEO METADATA SUPPORT
============================================================

Build reusable generic extractors for:

JSON-LD VideoObject
OpenGraph
oEmbed
RSS/Atom
WordPress
HTML cards

These should work across sites where metadata follows common standards.

Create fixture-based tests for each.

============================================================
12. FULL COLLECTION SCANNING
============================================================

"All available pages" must actually mean:

all publicly reachable items from that provider/collection.

Do not impose an arbitrary UI limit such as:

5 pages
25 pages
50 pages

unless the source itself imposes it.

Implement:

cursor pagination
page pagination
infinite-scroll API pagination
checkpoint persistence
deduplication
retry with exponential backoff
rate limiting
resume
pause/cancel

If a single source reports 1,146 videos:

VideoScope should attempt to obtain all publicly reachable 1,146.

The UI should show progress such as:

Found 240 / 1,146

Reading page 12

Retrying page 13

Found 780 / 1,146

Enriching metadata 400 / 1,146

Complete — 1,146 unique videos

If only 1,000 are technically reachable:

DO NOT label the collection complete.

Show:

1,000 / 1,146 publicly reachable
Partial coverage

============================================================
13. COLLECTION FILTERING — THIS IS THE CORE PRODUCT
============================================================

Once normalized, EVERY provider must use the SAME filtering engine.

Implement:

text search:
title
uploader
tag/category
description if available

upload period:
today
last 7 days
last 30 days
last year
custom start date
custom end date

views:
minimum views
maximum views

likes:
minimum likes
maximum likes

comments:
minimum comments
maximum comments

rating:
minimum rating
maximum rating

duration:
minimum duration
maximum duration

quality:
HD only
resolution when available

source/provider filter

uploader filter

has thumbnail

has known views

download supported

Sorting:

Most viewed
Least viewed

Most liked
Least liked

Most commented

Highest rated
Lowest rated

Newest
Oldest

Longest
Shortest

Title A-Z
Title Z-A

Unknown values should naturally sort after known values unless the user
explicitly requests otherwise.

ALL filtering must apply to the entire stored collection, not merely the
24 currently rendered cards.

============================================================
14. PERFORMANCE
============================================================

Do not render 1,146 cards simultaneously.

Use:

pagination
or virtualization

Suggested result-page sizes:

24
48
96

But FILTERING must run over the complete collection.

Persist normalized records in the backend/database.

Create suitable indexes.

The browser should not have to download the whole raw dataset repeatedly
just to change a filter.

Consider server-side filtering for very large collections.

============================================================
15. CLOUD DEPLOYMENT — MIGRATE AWAY FROM DEPLOY-PER-FIX NETLIFY DEVELOPMENT
============================================================

Current frontend is on Netlify.

Do NOT delete it yet.

Keep it available as rollback during migration.

Preferred new architecture:

Cloudflare
    static frontend / Pages
    Worker API gateway / orchestration
    D1 for collection/video/scan state
    R2 only where object storage is genuinely useful
    Queues for background scan tasks if appropriate

Use Cloudflare's free-tier-friendly architecture.

DO NOT put CPU-heavy video conversion, FFmpeg, yt-dlp, Chromium/Playwright,
or huge file processing inside a Cloudflare Worker.

If a container service is necessary for heavyweight/provider-specific tasks:

create a clean interface such as:

Provider Worker / Media Worker service

and deploy that separately to:

Railway
Cloud Run
Render
Fly.io
or another appropriate container host

Choose after measuring resource requirements.

For the first production migration, prefer minimizing paid infrastructure.

============================================================
16. DEPLOYMENT COST CONTROL
============================================================

One of the biggest frustrations in this project has been repeated production
deployments just to discover obvious bugs.

STOP THAT.

Development flow must be:

feature branch
↓
local tests
↓
unit tests
↓
provider fixture tests
↓
integration tests
↓
E2E browser tests
↓
optional preview
↓
ONE production deployment when acceptance tests pass

Do not deploy production on every small commit.

Configure CI accordingly.

Prefer:

manual production workflow_dispatch

or

protected release/tag deployment

after all required checks are green.

Keep Cloudflare preview deployments disabled or controlled if they create
unnecessary noise/resources.

============================================================
17. DATABASE / PERSISTENCE
============================================================

Use persistent storage.

If Cloudflare architecture is selected, D1 is acceptable.

Suggested logical tables:

providers
collections
scan_jobs
videos
collection_videos
scan_checkpoints

Possibly:

provider_credentials references/config state

Do not store API secrets in D1 plaintext.

Secrets belong in deployment secret storage.

Use schema migrations.

Add indexes for:

collection_id
provider
published_at
views
likes
comments
duration
uploader
source_video_id

============================================================
18. SCAN JOBS
============================================================

Long scans must survive:

page refresh
browser close
temporary network failure

A browser should merely START the scan.

The backend owns the job.

Frontend can poll/subscription update:

GET /api/scans/:id

or equivalent.

Possible states:

queued
enumerating
enriching
complete
partial
paused
failed
cancelled

Provide:

Pause
Continue
Cancel

Do not require the user to keep the tab alive for correctness.

============================================================
19. RETRIES / NETWORK FAILURES
============================================================

Implement bounded retry/backoff.

Examples:

connection reset
429
temporary 5xx
timeout

Do not blindly retry:

403 authorization denial
404
invalid URL
unsupported provider

Respect Retry-After.

Add jitter.

Store progress before advancing the cursor/page so retries do not lose
hundreds of results.

============================================================
20. SECURITY / PUBLIC CONTENT RULES
============================================================

This product is for public metadata and authorized provider APIs.

Do not:

bypass logins
bypass paywalls
solve CAPTCHAs
circumvent DRM
access private accounts
access friends-only/private videos
evade provider access restrictions
steal cookies/session tokens
circumvent provider rate limits

Protect the backend from SSRF.

Validate:

scheme
hostname
redirect destination
private/loopback IP ranges
cloud metadata addresses

Limit response sizes.

Limit concurrency.

============================================================
21. DOWNLOAD FEATURE — SECONDARY TO COLLECTION DISCOVERY IN THIS REBUILD
============================================================

The larger filtering/indexing product is the priority.

However, do NOT leave another fake Download button.

Rule:

If download is not end-to-end implemented for a provider:

hide the Download button

or show:

Download unavailable for this source

Do NOT redirect the browser to a remote URL and call that a download.

If downloads are retained:

use the existing/new media backend architecture.

Support only provider/media combinations that are genuinely implemented.

Real workflow:

Analyze video
↓
Backend selects allowed/retrievable media representation
↓
Backend downloads/assembles/remuxes when necessary
↓
Validate with MIME/signature/FFprobe
↓
Return Content-Disposition attachment
↓
Browser saves actual playable file

If FFmpeg/yt-dlp or large temporary files are needed:

run this in the dedicated container backend,
NOT Cloudflare Workers.

Do not block launch of the collection/filtering product on unsupported
download providers.

But never show a fake working Download button.

============================================================
22. EXISTING UNFINISHED MEDIA CODE
============================================================

Inspect repository branches/history for any unfinished media backend work.

Reuse good implementations if they are technically sound.

Look for functionality such as:

FastAPI
FFmpeg
FFprobe
HLS
DASH
Content-Disposition
filename editing
download jobs
progress
Railway deployment

Do not merge it simply because it exists.

Run its tests.

Only enable it in production if mandatory download E2E tests pass.

============================================================
23. UI / UX
============================================================

Keep the current VideoScope visual identity unless there is a strong
technical reason to change it.

Dark/light mode.

Desktop and mobile.

But stop spending most of development time redesigning the hero section.

The important UI is:

source input

provider detected

scan progress

collection completeness

metadata coverage

filters

sort

results

details

saved/bookmarked videos

provider/setup errors

On a source that needs credentials, show a useful configuration state.

Example:

YouTube detected
YouTube API not configured
Add YOUTUBE_API_KEY to the backend environment

NOT:

0 videos

============================================================
24. PROVIDER CAPABILITY MATRIX
============================================================

Create a capability system.

Example output:

YouTube
Collections: YES
Profiles/channels: YES
Search: depends on API mode
Views: YES
Likes: YES
Comments count: YES when exposed
Ratings: NO
Download: optional/not enabled
Credential: YOUTUBE_API_KEY

TokyoMotion
Collections: YES
Search: YES
Views: YES
Rating: YES when source publishes
Download: provider capability

Generic WordPress/RSS
Collections: YES
Views: maybe
Dates: YES
Thumbnails: often via REST API
Download: usually NO

Instagram
Provider: available only when authorized Meta API configuration permits
particular data

The application can expose this in an About/Providers screen.

============================================================
25. TEST ARCHITECTURE
============================================================

Create THREE levels of tests.

LEVEL A — fixture/unit tests

No network.

Keep sanitized snapshots of representative source HTML/API payloads.

Test every provider parser.

LEVEL B — integration/provider contract tests

Use mock HTTP servers.

Test:

pagination
cursor handling
dedupe
retry
429
500
empty intermediate page
partial collection
checkpoint resume

LEVEL C — controlled live smoke tests

Run manually, not on every commit.

Use environment keys.

Test representative sources.

Do not make CI depend permanently on arbitrary third-party websites.

============================================================
26. REQUIRED REGRESSION TESTS
============================================================

Before production migration, test at minimum:

YouTube:
https://www.youtube.com/@FilmiIndian/videos

Expected:
Provider detected as YouTube.
Collection is NOT zero merely because generic HTML parsing fails.
With API configured, retrieve the publicly accessible channel upload
collection and metadata through the provider implementation.

TokyoMotion profile:
https://www.tokyomotion.net/user/yua_xx/videos

Expected:
Existing behavior does not regress.

TokyoMotion search:
https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos

Expected:
Attempt the complete publicly reachable result set.
Compare expected vs collected.
No arbitrary 25-page stop.

WordPress/RSS archive:
https://internetchicks.com/actress/lillian-phillips/

Expected:
Use generic RSS/WordPress strategy when appropriate.
Titles/dates/thumbnails should be populated when publicly available.

Generic fixtures:
JSON-LD VideoObject
RSS
Atom
WordPress REST
OpenGraph
oEmbed

Meta:
Use mocked official API fixture in CI.
Live test only when credentials are configured.

============================================================
27. ACCEPTANCE TEST FOR FILTERING
============================================================

For a completed collection, automatically verify:

Most viewed sorts correctly

Least viewed sorts correctly

Newest sorts correctly

Oldest sorts correctly

minimum views filters correctly

maximum views filters correctly

date range filters correctly

duration range filters correctly

uploader search works

title search works

unknown view counts are not treated as 0

pagination does not alter sort correctness

mobile and desktop return the same logical ordering

============================================================
28. MOBILE ACCEPTANCE
============================================================

Use Playwright.

Test:

375px
390px
430px

Check:

no horizontal overflow
input usable
Analyze button usable
progress visible
filters usable
results readable
detail panel usable
pagination usable
continue/pause controls usable

============================================================
29. OBSERVABILITY
============================================================

Add structured logs.

For each scan:

scanId
provider
source type
current cursor/page
items received
unique items
duplicates
request duration
HTTP status
retries
expected count
final count
completion state

Do not log secrets.

Build an optional diagnostics panel so we stop debugging from screenshots
alone.

============================================================
30. COST / RATE LIMITING
============================================================

The application must not hammer providers.

Per provider implement:

request concurrency
delay/rate policy
retry policy
cache TTL

Cache metadata where appropriate.

Do not refetch 1,146 unchanged videos every time the user clicks Analyze.

If the same collection was scanned recently:

offer:

Use cached collection
Refresh changed items
Full rescan

This is important for API quotas and infrastructure cost.

============================================================
31. CLOUD MIGRATION PLAN
============================================================

Do NOT immediately shut down Netlify.

Phase A:

Build Cloudflare version independently.

Phase B:

Run automated + live acceptance tests on Cloudflare preview.

Phase C:

Compare:

old Netlify
new Cloudflare

Phase D:

Only after Cloudflare passes, move the primary public URL.

Phase E:

Keep Netlify rollback deployment temporarily.

Then retire it later.

Document the rollback process.

============================================================
32. CLOUDFLARE CONFIGURATION
============================================================

Create whatever is needed, for example:

wrangler.jsonc / wrangler.toml

D1 migrations

Queue bindings

R2 binding only if necessary

Worker routes

Pages/build configuration

environment examples

Secrets must NOT be committed.

Create:

.env.example

with names only.

Document commands such as:

local dev
test
database migration
preview
production deploy

============================================================
33. DO NOT CLAIM UNIVERSAL WEBSITE SUPPORT
============================================================

This is important.

No engineering system can honestly guarantee arbitrary website support.

The PRODUCT should feel universal because it has:

provider detection
standards-based generic extraction
modular adapters
clear capability reporting

The application must never falsely claim:

"works with every website."

Instead:

"VideoScope supports registered providers and standards-compatible public
video collections. New providers can be added through adapters."

This is more professional and avoids the current situation where unsupported
URLs mysteriously return zero.

============================================================
34. AUTONOMY
============================================================

Do not repeatedly ask me questions that can be answered by examining:

the repository
git history
tests
source documentation
provider APIs
current production behavior

Proceed autonomously.

If a credential is required:

implement everything around it

add the env variable

add mocks/fixtures

add setup documentation

then clearly identify the ONE credential/configuration step I need to provide.

Do not stop the entire project merely because one API key is missing.

============================================================
35. DO NOT WASTE DEPLOYMENTS
============================================================

Do not use production as your test environment.

Before production deployment:

npm/python dependency install

lint

typecheck

unit tests

provider fixture tests

backend tests

integration tests

Playwright desktop

Playwright mobile

build

database migrations on test DB

preview smoke tests

THEN production.

If any required check fails:

do not deploy.

============================================================
36. DEFINITION OF DONE FOR THIS CODEX TASK
============================================================

Do NOT say "done" because the website loads.

The task is done only when:

1. VideoScope has a genuine provider-adapter architecture.

2. YouTube @FilmiIndian/videos works through the YouTube provider when its
   required API configuration is present.

3. Existing TokyoMotion functionality still works.

4. Large collections are persistent/resumable.

5. "All available pages" is actually provider-driven and not capped at 25.

6. Filtering works over the full collection.

7. Unknown metrics are represented honestly.

8. WordPress/RSS fallback works generically.

9. Unsupported sources produce a meaningful capability/error state instead
   of fake zero results.

10. Mobile and desktop are tested.

11. Cloudflare deployment is successfully tested.

12. Production is deployed only after all required checks pass.

13. A final verification report is produced.

============================================================
37. FINAL VERIFICATION REPORT
============================================================

At completion print a table:

Feature | Provider/Test | Expected | Actual | Pass/Fail

Include at minimum:

YouTube channel enumeration
YouTube metadata enrichment
TokyoMotion profile
TokyoMotion search/full collection
WordPress/RSS archive
generic JSON-LD
collection persistence
pause/resume
deduplication
most viewed
newest/oldest
min/max views
date range
duration range
mobile 375
mobile 390
mobile 430
Cloudflare production
download E2E if downloads are enabled

Also print:

production URL
GitHub commit SHA
provider capability matrix
database migration version
environment variables still required
known limitations

DO NOT hide failing rows.

============================================================
38. CLEAN UP PREVIOUS EXPERIMENTS
============================================================

After the replacement system is verified:

mark deprecated scanners/providers clearly.

Do not leave five competing implementations used unpredictably.

Delete dead code only after tests prove it is no longer needed.

Update README so the next developer understands:

provider architecture
scan lifecycle
filter engine
database
Cloudflare
optional heavy backend
how to add a provider

============================================================
39. WHAT I EXPECT YOU TO DO NOW
============================================================

Do not reply with only a plan.

Begin by inspecting Tahmid447/videoscope.

Create the feature branch.

Run the current tests.

Reproduce the YouTube 0-result bug.

Document the current architecture.

Implement the provider system.

Implement YouTube properly.

Move existing TokyoMotion and WordPress/RSS logic into providers.

Implement persistent scan jobs.

Implement full filtering.

Add tests.

Build the Cloudflare target.

Run all acceptance tests.

Deploy a preview.

Verify it.

Only then deploy production.

Do not repeatedly deploy broken intermediate versions.

Do not optimize for making one URL look fixed.

Optimize for making VideoScope a real extensible product.
