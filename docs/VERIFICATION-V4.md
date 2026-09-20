# VideoScope verification — quota recovery checkpoint

Source commit: `1c888442a2d1b6baf7129de6db699a764f15cb12`.
Preview: https://videoscope-v4-preview.tahmidhc245.workers.dev
Existing production/rollback: https://videoscope-3-tahmid.netlify.app
Pull request: https://github.com/Tahmid447/videoscope/pull/6
Deterministic CI: https://github.com/Tahmid447/videoscope/actions/runs/35514707264
Final hosted acceptance (cancelled; quota exhausted and mobile failure recorded): https://github.com/Tahmid447/videoscope/actions/runs/35514842775
Database migration: `0001_provider_engine.sql`.

The implementation, original requirements and recovery notes are saved on GitHub.
The preview D1 backup was restored to temporary SQLite and checked successfully.
Existing production data and the rollback deployment were not changed.

| Feature | Provider/Test | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| YouTube enumeration | Official live channel API | Exhaust uploads playlist | 2,473 / 2,473; 50 pages | PASS data collection; hosted mobile 375 failed, fix passed locally |
| YouTube enrichment | Official live videos.list batches | Populate available metadata | 2,473 titles/thumbnails/views/dates; 2,472 durations; 2,456 likes; 2,403 comments | PASS data collection; hosted mobile 375 failed, fix passed locally |
| TokyoMotion profile | Hosted real source | Preserve complete enumeration | 72 / 72; 4 pages | PASS on current preview |
| TokyoMotion full search | Hosted public sort windows | Exhaust publicly reachable pages; report shortfall | Earlier run: 1,145 / 1,150; 252 pages. Current run: 1,141 / 1,150; 237 pages, blocked by quota | BLOCKED current run; prior partial contract passed |
| WordPress/RSS archive | Hosted generic scoped feed | Titles, dates, thumbnails | 109 records; 12 pages; complete | PASS on previous preview; final run pending |
| Generic JSON-LD / OG / oEmbed / RSS / Atom / WP | Fixtures | Standards metadata, no site-specific phrase rules | All fixtures pass | PASS |
| Arbitrary Facebook/Instagram public profiles | Latest user request | Collect any public profile | Current adapter cannot provide this; public visibility alone is insufficient for its authorized API connection | NOT SUPPORTED |
| Meta | Mock authorized Graph API | Token kept server-side; authorized mapping | Fixtures pass; no live credentials | PASS fixtures; live optional |
| Persistence | Real D1 runtime restart | Keep cursor and saved rows | 1,146 items / 58 pages plus shutdown/restart test | PASS |
| Pause/resume/cancel | D1 lease/revision tests; hosted controls | Preserve records; fence in-flight work | Tests pass | PASS |
| Deduplication | Repeated records and queue delivery | One membership per unique ID | Tests pass | PASS |
| Most/least viewed | Whole-collection SQL + hosted API | Correct across all pages; null last | Tests pass | PASS |
| Newest/oldest | SQL + hosted API | Correct dates across pagination | Tests pass, including time-zone normalization | PASS |
| Min/max views | SQL + hosted API | Exact qualifying IDs; null excluded | Tests pass | PASS |
| Date range | SQL + hosted API | Inclusive calendar end date | Tests pass | PASS |
| Duration range | SQL + hosted API | Exact qualifying IDs | Tests pass | PASS |
| Title/uploader search | SQL + hosted API | Search complete saved collection | Tests pass | PASS |
| Desktop 1440 | Playwright local and hosted | Usable controls and logical ordering | Prior three-source checks passed; current YouTube 375px overflow found and corrected locally | Local fix PASS; hosted recheck pending |
| Mobile 375 | Playwright local and hosted | No overflow; details/pagination usable | Prior three-source checks passed; current YouTube 375px overflow found and corrected locally | Local fix PASS; hosted recheck pending |
| Mobile 390 | Playwright local and hosted | Same ordering as desktop | Prior three-source checks passed; current YouTube 375px overflow found and corrected locally | Local fix PASS; hosted recheck pending |
| Mobile 430 | Playwright local and hosted | Same ordering as desktop | Prior three-source checks passed; current YouTube 375px overflow found and corrected locally | Local fix PASS; hosted recheck pending |
| Credential secrecy | Tracked-file scan | No supplied API key committed | Passed; .dev.vars private and ignored | PASS |
| Dependency audit | npm audit | No known vulnerabilities | 0 known vulnerabilities | PASS at checkpoint |
| Cloudflare production | Exact-SHA release gate | All acceptance passes before one deployment | Free D1 write quota exhausted; user chose reset at 09:00 JST September 21; no app deployed | BLOCKED |
| Download E2E | Disabled capability | No unverified download button | Downloads unavailable; media branch isolated | N/A |

Local total: **85 passing tests** (51 legacy/core, 16 provider/network, 11 D1
integration, two acceptance-client, five Playwright), plus lint, typecheck,
static/Worker builds and migration checks. The previous preview ran commit
`024d9eaa2cf06163593a272c9679be731cf68c82`; final hosted acceptance uses the source
commit listed at the top. Do not confuse earlier live evidence with final approval.

## Provider capabilities and limitations

| Provider | Collection support | Metrics when exposed | Required setup | Downloads |
|---|---|---|---|---|
| YouTube | Uploads/channel, playlist, video; optional API search | Views, likes, comments, date, duration, uploader, thumbnails, HD | YOUTUBE_API_KEY (now configured) | Unavailable |
| TokyoMotion | Public profile/search/category listings and pagination | Views, rating, duration, approximate dates, thumbnails | None | Unavailable |
| WordPress/RSS/Atom | Scoped public feeds and REST collections | Titles, dates, author, tags, thumbnails; other metrics nullable | None | Unavailable |
| Generic standards | Verified JSON-LD, OpenGraph, oEmbed, HTML cards, video sitemap | Only source-published fields | None | Unavailable |
| Facebook/Instagram | Explicitly authorized account/page mappings | Official API fields permitted by token/version | META_ACCESS_TOKEN, META_GRAPH_VERSION, META_AUTHORIZED_SOURCES (optional) | Unavailable |

Unknown metrics remain null. No universal website support is claimed. Login-only,
private or denied sources are not bypassed. Search can be partial when public
pagination does not expose every source-reported item. Relative dates are marked
approximate. Browser workspaces are device-specific; use JSON export/import to
move saved collections. Existing Netlify collections are not automatically moved.
YouTube search remains disabled by default for quota control. Cloud quotas apply;
no paid plan was enabled.

Meta reference: https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login (official Meta collection; excludes consumer Instagram accounts). The current adapter does not implement unrestricted public profile collection.

## Latest recovery checkpoint

The large total-views statistic caused 6px overflow at 375px. The correction and a multi-billion-view fixture passed all five browser tests at 1440/375/390/430. It is not yet deployed to preview. The CI workspace is now persisted in an encrypted GitHub secret so the next run can reuse saved collections. Final hosted approval remains required.

The latest SQL backup restored successfully with 3,797 video rows, six collections, six jobs and 559 checkpoints. The user chose the free reset; a one-time desktop continuation is scheduled for September 21 at 09:05 Japan time.
