# Verification: VideoScope 3.3

## Completed before production deployment

On 2026-09-19, the repaired parser was run against all four public pages of the supplied regression profile. The source reported 72 entries and the collector returned 72 unique video records. Original titles, thumbnail URLs, views, ratings and source date labels were compared to independent DOM observations. No navigation labels were accepted.

The Netlify deploy preview then completed a full hosted scan, reading all 72 individual detail pages without detail-request failures. All 72 records had source titles, thumbnail URLs, view counts, ratings and source date labels. All 72 detail pages exposed source media-file links. No public comment text was found in those returned detail pages.

The source supplied relative date labels, not exact upload timestamps, for these 72 entries. These remain explicitly approximate. This test does not support claiming exact calendar dates for that profile.

24 unit/regression tests and 48 desktop/mobile browser assertions passed. Controlled UI tests use synthetic fixtures only inside the test runner; the app never substitutes these for failed live scans. Live preview browser tests also passed for loading a real collection, ranking, details, theme switching and bookmarking.

An additional live W3C HTML video demonstration page was detected correctly and exposed three source media links.

## Test evidence

- Unit, live extraction and UI run: https://github.com/Tahmid447/videoscope/actions/runs/35440497678
- Hosted preview API and browser run: https://github.com/Tahmid447/videoscope/actions/runs/35440602824

The thumbnail HEAD probe from the server timed out. Original thumbnail rendering is therefore being tested separately in an actual browser rather than assumed from a stored image URL.

## Not asserted

This is not a guarantee that every website or every future source layout works. It does not establish the availability of private videos, exact timestamps absent from a source, historical view counts, or unexposed comments. Public source file links may expire or open in the browser instead of downloading.
