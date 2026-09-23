# Facebook and Instagram: setup and remaining access work

Checked September 23, 2026. **Not configured or live-verified in VideoScope.**
YouTube is already configured. Do not replace its existing key or buy another key.

## Current setup checkpoint

The user completed developer registration and created VideoScope, app ID
`2254262295147290`. The app includes Instagram and Pages use cases and remains
unpublished. No business portfolio is attached.

Login configuration `VideoScope Read Access` (`1085883213805922`) is saved as a
General / User access token configuration. It requests only `instagram_basic`,
`instagram_manage_insights`, `pages_read_engagement`, and `pages_show_list`.
Graph API Explorer v26.0 has this configuration selected. The current step is
user authorization via Generate Access Token. No Meta token is installed locally
or in Cloudflare, and target-profile access remains unverified.

The [current Business Discovery reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)
requires a Facebook user token with the first three scopes. `pages_show_list`
locates the linked Instagram account. If Page roles came through Business
Manager, that reference also requires `ads_read` or `ads_management`; neither
has been requested. Do not add those unless the actual connection requires it.

The [current guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery)
allows nested public media reads for eligible professional accounts, with
source limitations. Account eligibility and field availability still need a real
small response. No full scans are needed to establish that.

## What access can accomplish

The deployed Meta adapter reads an explicitly authorized Facebook Page's videos
or Instagram professional account's video media. It is not a general public
profile crawler. A Meta access token is not a universal API key for any URL.

Meta's [official Instagram API collection](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login)
requires a professional account linked to a Facebook Page for its Facebook Login
route and excludes consumer accounts. It also documents limited metadata access
to other businesses/creators. Business Discovery is a possible extension for
eligible public professional profiles, but that extension is not implemented or
verified here. A public profile and visible Reels do not prove API eligibility
or full history/metrics coverage.

For Facebook Pages not administered by the connecting user, consult Meta's
[Page Public Content Access review requirements](https://developers.facebook.com/docs/features-reference/page-public-content-access/).
A normal Page token must not be assumed to authorize another Page's Reels.
Review approval, supported Reels endpoints and coverage need confirmation.
Meta's reference site returned a rate limit during this audit; current detailed
requirements must be checked in the developer dashboard before requesting access.
No arbitrary personal-profile access is implemented.

## Start without buying a third-party service

No paid scraper, proxy, subscription or hosting upgrade is part of this setup.
API approval and quotas remain separate from cost, and no guaranteed free
any-profile service has been established. Begin with the official developer
account and one bounded API response; stop if it cannot expose the requested
public account rather than scanning thousands of items.

1. Open [Meta for Developers — My Apps](https://developers.facebook.com/apps/).
   Sign in and complete any developer registration yourself.
2. Create/select an app that supports Instagram API with Facebook Login and
   Facebook Pages. Use the app dashboard's current setup flow. Do not enable
   publishing or messaging features just for this read-only integration.
3. For the Instagram Facebook Login route, connect your own Instagram Business
   or Creator account to a Facebook Page you manage. This creates your API
   connection; it does not imply ownership of the public target profile.
4. Use [Graph API Explorer](https://developers.facebook.com/tools/explorer/) for
   the selected app. Request the read permissions needed by that setup,
   `instagram_basic`, `instagram_manage_insights`, `pages_show_list` and
   `pages_read_engagement` for the planned Business Discovery check.
   Follow the dashboard's permission/review requirements; token presence alone
   does not mean access has been granted.
5. Meta's [managed Pages token example](https://www.postman.com/meta/instagram/request/0vuw3vk/get-access-tokens-of-pages-you-manage)
   retrieves Page IDs, a Page token and the linked Instagram account ID. Keep
   those values private. Do not paste access tokens into chat or GitHub.
6. Before a full collection, verify only a small response from the intended
   endpoint, with the intended token, current Graph version and requested fields.
   For somebody else's Instagram professional account, assess Business Discovery
   eligibility first. This needs new adapter work after access is established.

## Configure only an actually authorized existing mapping

Preserve `YOUTUBE_API_KEY` in ignored `.dev.vars`. Add the following only after
obtaining valid access. Replace all placeholders; `vNN.0` is not a real version.
Use the version selected by the Meta app dashboard.

```dotenv
META_ACCESS_TOKEN=your_private_token
META_GRAPH_VERSION=vNN.0
META_AUTHORIZED_SOURCES=[{"url":"https://www.instagram.com/YOUR_AUTHORIZED_ACCOUNT/reels/","objectId":"INSTAGRAM_NUMERIC_ID","kind":"instagram"},{"url":"https://www.facebook.com/YOUR_AUTHORIZED_PAGE/reels/","objectId":"PAGE_NUMERIC_ID","kind":"facebook"}]
```

The current adapter compares the exact normalized URL, including its path.
Do not map another person's account merely because its numeric ID is known.
One configured token must legitimately cover every mapping; separate tokens per
source are not supported by this adapter. No credentials are configured yet.

Once the connection works, store its secrets in the preview Worker privately,
run a small targeted access/metadata check and validate necessary code changes.
Promote only after required checks pass. Do not mark Meta supported based on
fixtures, a successful login or a public browser page alone.

## Keep credit use bounded

Reuse the existing release evidence and saved collections. Do not rerun the
2,473-video YouTube scan or 267-page search to configure Meta. A small real API
response plus focused adapter tests is the next useful validation.

OpenAI explains that model choice, context, reasoning and tool use affect usage;
large outputs and long sessions also contribute. There is no fixed credit cost
per test. See [official Codex pricing and usage guidance](https://learn.chatgpt.com/docs/pricing).
The completed quota-reset automation is paused. No new background scans are scheduled.
