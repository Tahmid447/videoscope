# VideoScope 3.7 search verification

## Real-source preflight, 19 September 2026 at 16:17 UTC

Source: TokyoMotion search for the supplied keyword, with the original search type, visibility and time scope preserved.

- Source reported 1,146 records; the scanner collected 1,146 unique records.
- Titles: 1,146. Thumbnail URLs: 1,146. View counts: 1,146. Source date/age values: 1,146. Durations: 1,146. Published ratings: 1,107; missing ratings were not replaced with zero.
- The original search exposed 50 pages per ordering, rather than enough pages to enumerate its stated total in one ordering. The scanner therefore combined only actual source-published alternative sorts of the same search and de-duplicated video identities.
- 250 page positions were examined across orderings, with 315 requests including retries. Six positions returned empty responses repeatedly; their records were recovered through other orderings, and the unique source-reported total was reached.
- This was a real HTML metadata test, not synthetic video data. No video bodies were fetched.
- 39 existing regression tests and 50 desktop/mobile UI assertions passed in that preflight. The UI assertions use a controlled API fixture; hosted checks are separate.

Evidence: https://github.com/Tahmid447/videoscope/actions/runs/35453971874

## Hosted verification

The preview workflow tests actual search extraction, saved-progress recovery, Continue/Pause, sorting, pagination and mobile controls. The production workflow repeats the complete supplied search and requires its unique count to match the source-reported total before passing.

Deployment and production verification must be checked separately; the preflight above alone is not a claim that the production website has been updated.
