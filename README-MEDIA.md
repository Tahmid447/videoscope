# VideoScope provider and media service

This companion adds backend attachment downloads and provider-backed collections
without replacing the existing native HTML and RSS collection readers.

## Architecture

The Netlify frontend sends small control requests through the existing API.
Netlify signs short-lived workspace-scoped tokens with VIDEOSCOPE_SECRET_KEY.
A dedicated Python service runs extraction and FFmpeg, keeps bounded temporary
files, and delivers attachments directly to the browser with signed tickets.
The browser is never redirected to a third-party media URL for a download.

Source providers are selected using yt-dlp's registry. Recognized sites use the
provider backend; native HTML/RSS sources retain their existing readers. A failed
empty HTML scan can fall back to the generic provider. Recognized does not mean
that every URL is retrievable: site changes, access requirements, removed videos,
encryption, and upstream errors remain explicit failures, never invented records.

## Local setup

Use Python 3.12+, Node 22+, FFmpeg/FFprobe and Deno 2+. Run:

    python -m venv .venv
    . .venv/bin/activate
    pip install -r requirements-media.txt
    npm install
    npm run build
    npm test
    python -m pytest tests_media -q

Copy .env.media.example, generate separate random keys, and export the variables.
Start the media service:

    uvicorn media_api.gateway:create_app --factory --host 127.0.0.1 --port 8000 --workers 1 --no-access-log

Configure VIDEOSCOPE_MEDIA_API and the same VIDEOSCOPE_SECRET_KEY in Netlify
Functions, then use netlify dev for the actual frontend/platform environment.
The developer fixture server is strictly a localhost-only test helper; it is not
included in the production Docker image.

## Deployment

Deploy Dockerfile.media on a container host such as Railway. Configure an HTTPS
service domain, a /health health check, one process/replica, the server variables,
and a persistent volume mounted at /data. Set VIDEOSCOPE_MEDIA_API on the existing
Netlify site, plus the matching secret in Functions scope. Never expose keys in
static assets. The access key is retained for explicit direct-service sessions;
normal users initialize through their existing device workspace automatically.

A persistent volume is required for collection checkpoints to survive redeploys.
Downloaded media is deliberately temporary: it expires after the configured
retention interval. Restarts cancel temporary download jobs; analyze/download
again rather than serving an incomplete file. Collection scans can be resumed
from saved records and deduplicate re-enumerated provider entries.

## Supported processing paths and limits

Direct recognized media, completed unencrypted HLS, supported static single-period
DASH, and provider-extracted HTTP/HLS tracks can be retrieved. Separate video and
audio are remuxed from local files without re-encoding. No video body is loaded
wholly into RAM. FFmpeg and FFprobe receive local files with protocol restrictions.

Defaults: 1 GiB media limit, 4 GiB temporary disk budget, one download worker,
20-minute download timeout, one-hour file retention, 10,000 provider records per
collection, two concurrent scan workers. Limit hits are reported as partial, not
complete. Configure limits based on actual host storage and capacity.

Metadata missing at the source stays missing. YouTube flat-list upload dates are
explicitly approximate; optional individual details may improve them. View counts
are the provider's source-displayed snapshot, not a promise of exact live analytics.
Only fields present in a record participate in numeric/date filters.

## Security

Public URL validation, DNS-to-socket pinning, private-address rejection, redirect
revalidation, subprocess argument arrays, an ephemeral extraction egress proxy,
workspace-scoped analysis/jobs, signed expiring file tickets, bounded queues and
temporary cleanup are implemented. Do not log tokens, media signatures or cookies.
Cookie and provider request headers remain server-side and origin-scoped.

## Verification

    pip install pytest httpx
    python -m pytest tests_media -q
    npx playwright install --with-deps chromium firefox webkit
    node scripts/media-browser-check.mjs
    python -m scripts.provider-preflight

The browser test uses generated real audio/video files served over local HTTP,
then verifies title/formats, Unicode filename editing, actual attachment bytes,
FFprobe output and browser playback for direct MP4, HLS and DASH. It is separate
from live-source and deployed-service verification. WebKit/viewport tests do not
constitute testing on physical iPhones, Android devices, macOS or Windows.

See artifacts-v4/browser-results.json and the workflow logs for actual outcomes.
A green build alone is not a claim that every provider or download was tested.
