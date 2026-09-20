# VideoScope 4

VideoScope supports registered providers and standards-compatible public video
collections. New providers can be added through adapters. It discovers public
video metadata, persists scan progress, and filters the entire saved collection
while rendering 24, 48, or 96 results at a time.

- Official YouTube uploads, playlists and video metadata; backend API key required.
- TokyoMotion public listings and published search sort windows.
- Generic JSON-LD, OpenGraph, oEmbed, scoped RSS/Atom, WordPress and video sitemaps.
- Official Meta API adapter for explicitly authorized account/page mappings.
- Durable backend jobs with pause, continue, cancel, retry and checkpoint recovery.
- Shared SQL filters, source thumbnails, nullable metrics, bookmarks, CSV and JSON backups.
- Existing VideoScope visual identity, light/dark themes and responsive layouts.

Downloads are unavailable. The audited media branch remains separate until real
hosted attachment/playback acceptance passes. A source that requires login,
blocks automated reads, or lacks a supported public interface reports that limit.

## Development

```sh
npm ci
npx playwright install chromium
npm run db:local
npm run dev
```

The Worker serves the static frontend and API. Local D1 persists in `.wrangler/`.
Copy `.env.example` to `.dev.vars` and fill only the credentials you use. Never
commit this file. The UI explains missing credentials instead of claiming a
successful collection with zero videos.

```sh
npm run check         # lint, types, legacy/unit/provider/integration, desktop/mobile, build
npm run db:local      # migration on local test D1
npm run test:live:v4  # controlled source checks; explicitly opt in
```

`test:live:v4` reads environment variables; use
`node --env-file=.dev.vars --import tsx scripts/live-v4.ts youtube` for a local key.
Fixtures are synthetic/sanitized and never bundled into the deployed app. Browser
tests use real D1 and the actual API with a test-only synthetic provider. The
hosted acceptance script uses actual providers without response injection.

## Architecture and release

- [Recovery checkpoint and remaining work](docs/HANDOFF.md)
- [Original project requirements](docs/PROJECT-BRIEF.md)
- [Existing-project inventory](docs/ARCHITECTURE-INVENTORY.md)
- [Provider contract, persistence and capabilities](docs/PROVIDER-ENGINE.md)
- [Credentials, deployment, migration and rollback](docs/DEPLOYMENT-V4.md)
- [Verification status](docs/VERIFICATION-V4.md)

Production deployment is manual and requires successful preview acceptance for
the exact commit. Netlify is retained as the v3 rollback deployment; its automatic
builds are disabled by the build-ignore command on this branch. The original
`static/`, Netlify functions and scanner are kept for rollback.

Device workspace keys scope server-side collections and bookmarks. They are
browser credentials, not user accounts or cross-device synchronization. Export a
JSON backup before moving between hosts or browsers; imports remain clearly
labeled user-supplied metadata. Saved HTML page import also reuses the verified metadata parser; HTML is limited
to 350 KB and JSON to 4.5 MB. Imports do not fetch or execute the saved page.
