# VideoScope

VideoScope is a responsive video-discovery workspace with a Netlify-hosted scanner.

## Current GitHub build

This repository is the source of truth for the repaired hosted build.

Working controls:
- Analyze a public profile/search/category/listing URL
- Dark / light theme toggle
- Saved-video browser bookmarks
- Import JSON or saved public HTML
- Search, upload-period filtering, and ranking
- JSON export
- Recent hosted collections
- Responsive desktop/mobile dashboard

## Netlify

Use the existing Netlify project: `videoscope-3-tahmid`.

Netlify settings are committed in `netlify.toml`:
- Publish directory: `static`
- Functions directory: `netlify/functions`
- No fragile frontend build step is required
- Netlify installs the dependencies in `package.json` for the scanner function

Once this repository is linked to that existing Netlify project, pushes to `main` can deploy automatically.

## Saved videos

Saved videos are bookmarks stored in the browser. They save the source link and collected metadata; they do not download video files.

## Privacy note

Hosted collection storage currently has no user accounts. Use only public, non-sensitive metadata.
