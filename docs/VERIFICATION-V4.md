# Verification evidence and outstanding release gates

This feature branch is a production candidate, not a production sign-off. The
release must remain blocked while a required live provider or preview gate is
unverified. Runtime/live JSON reports and browser screenshots are generated under
ignored `artifacts/`; CI uploads deterministic artifacts, and the controlled
acceptance workflow uploads actual hosted evidence.

## Verified locally during implementation

- Original extractor/pagination/core regression suite retained and passing.
- Network-free YouTube, Meta, TokyoMotion and generic metadata fixtures.
- Public-address/redirect/robots/body-size checks against a mock HTTP server,
  including 429, 500, 403 and credential redirect rejection.
- Real local D1: 1,146 records over 58 pages, duplicates, full-collection SQL
  filters/sorts, owner isolation, atomic pause fencing and resume.
- Complete shutdown/recreation of the local Worker runtime with persisted D1,
  followed by cursor recovery and duplicate-message handling.
- A 50-record commit stays below the free D1 query and binding budgets.
- JSON/HTML imports, isolated imported records, and bookmarks beyond 96 items.
- Partial enumeration still enriches records and can resume the failed page.
- Repeated runtime termination is bounded and becomes an explicit failure.
- Playwright at desktop 1440px and mobile 375px, 390px, 430px: full stored ordering,
  pagination, filters, details, bookmarks, themes, pause/reload/continue, CSV,
  missing-key state, no horizontal overflow and no browser exceptions.
- Static and Worker dry-run builds; schema migration on local and preview D1.
- Actual local Worker/Queue/D1 runtime live profile scan: 72 records, four pages,
  five requests, complete without warnings.
- Controlled archive live scan: 109 records, all with titles, dates and source
  thumbnails; 12 feed reads including the verified WordPress end-of-feed 404.
- Isolated unfinished media branch backend tests: 21 passed. Downloads remain
  disabled because deployed attachment and playback tests are not completed.
- `npm audit`: no known vulnerabilities after updating build-time dependencies.

## Live issues found and corrected

A generic RSS discovery could broaden a taxonomy archive to the root feed. It now
accepts only feeds with the exact source path/query scope. A guessed WordPress
continuation used to stop with a partial error on the terminal 404; that is now
an exhaustion signal only for a verified WordPress feed's inferred next page.

The search source intermittently omits pagination links and sometimes returns
an empty listing. The adapter remembers the source-published numeric range,
traverses all five published sort orders, retries empty intermediate responses
and revisits remaining gaps once. It never substitutes the reported total for
collected unique IDs. The manual live report records the final reached count,
reported total, per-order page counts, warnings and actual completeness.

## Required before production

1. Configure `YOUTUBE_API_KEY` and run the actual channel regression. The mocked
   61-item API test is not a substitute for this live check.
2. Complete controlled live search verification with the final retry implementation.
3. Deploy the exact committed build to the isolated preview and run
   `scripts/hosted-v4.mjs`, including actual providers and desktop/mobile browser
   ordering checks. The script reports a missing YouTube key as blocked and fails
   overall acceptance even if other providers pass.
4. Inspect preview CPU/quota behavior, confirm the deployed `buildSha`, and run
   exact-commit acceptance through the manual workflow before a production release.

Netlify production remains the rollback site. No v4 production migration is
claimed by this document. Consult the final user-facing report and the exact
commit's acceptance artifacts for deployment URLs and the final verification table.
