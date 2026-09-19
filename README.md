# VideoScope

VideoScope is a responsive video-discovery workspace with a Netlify-hosted scanner, filtering, sorting, browser bookmarks, import/export, and light/dark themes.

## Current repair

This source fixes the frontend startup bug that prevented Analyze, Import, Saved videos, and theme switching from initializing on the deployed site.

- Scripts are emitted after all page controls.
- Startup is guarded by `DOMContentLoaded`.
- Analyze submits to the hosted scanner API and surfaces errors.
- Saved videos are browser bookmarks, not downloaded video files.
- Light/Dark mode is explicit and works on desktop and mobile.
- Netlify build: `npm run build && npm test`
- Publish directory: `static`
- Functions directory: `netlify/functions`

## Important backend note

The hosted collection storage currently has no user login. Use it only for public, non-sensitive metadata. A private GitHub repository would not make the deployed website private.

## Deployment

Link this repository to the existing Netlify project `videoscope-3-tahmid` using Netlify Continuous Deployment. After that, pushes to `main` will build and deploy automatically.
