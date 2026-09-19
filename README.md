# VideoScope 3.3

Source-faithful video metadata collection with a Netlify-hosted scanner and responsive browser workspace.

## What changed

The original generic scraper misclassified navigation links as video records. This version reads actual video-card containers, isolates each card's fields, follows forward pagination within the same collection, and verifies archive candidates before counting them as videos.

- Original source titles and thumbnail addresses; no generated titles or fake records.
- Views, ratings and their scales, duration, source upload-age text, and available exact upload dates.
- Optional per-video public detail reading for description, tags, publicly exposed comments, and explicit media/download links.
- Coverage indicators: source-reported total, collected count, source pages, and populated fields.
- Search, custom dates, minimum views/likes, duration limits, HD filter, sorting and result pagination.
- Details dialog, source links, local bookmarks, light/dark themes, and accessible mobile navigation.
- Spreadsheet-compatible CSV output. JSON backup/import is under Tools rather than the main workflow.
- Browser-isolated collections use a random workspace bearer key. Bookmarks remain on the device. This is not account-based cross-device synchronization.

## Verification

`npm test` runs extractor, pagination, date-precision, safe-URL, private-network, and source-reading regression tests.

`npm run test:live` compares all public entries on the designated regression source with independent DOM observations, and reads a separate W3C video demonstration page. It logs counts and comparisons, not media or full titles.

`npm run test:ui` exercises desktop/mobile controls with explicitly synthetic fixture responses. These fixture results are never served by the application.

`node scripts/hosted-check.mjs` tests the actual hosted scanner, storage isolation and browser controls against real public metadata. Test collections are isolated from real users and deleted afterward.

## Deployment

Netlify project: `videoscope-3-tahmid`. Main branch is linked to GitHub. Netlify runs `npm run build && npm test`, serves `static`, and bundles `netlify/functions/api.mts`.

## Scope and precision

A source that supplies only “N days ago” does not provide an exact timestamp. The original phrase is retained, and any calculated date is labeled approximate. Ratings on different scales are not silently treated as interchangeable. Missing metrics stay null.

Direct source files are links, not a video download proxy. Browsers may open rather than download them. Source access controls, login restrictions and DRM are not bypassed. Sites can refuse server requests or use unsupported layouts; those failures must not be reported as a successful empty collection.

This is a personal-study web app, not a claim of universal source compatibility or a completed production security audit.
