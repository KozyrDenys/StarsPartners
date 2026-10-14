# chacha.bet product remediation contract

These production changes are outside the QA repository. The contract below gives the edge,
frontend, and sportsbook owners concrete implementation and acceptance criteria.

## WAF policy

The mobile run is dominated by Cloudflare challenge responses on authenticated and casino
routes. In the `chacha.bet` zone:

1. Create a managed `qa_egress_ips` list containing only static QA/CI egress addresses.
2. Add a custom rule before the managed challenge rule:

   ```text
   (http.host eq "chacha.bet"
    and ip.src in $qa_egress_ips
    and http.request.method in {"GET" "HEAD"}
    and http.request.uri.path in {"/" "/assets/" "/casino/" "/livecasino/" "/sports/"})
   ```

3. Skip only the bot/managed-challenge checks that block HTML documents. Keep DDoS protection,
   rate limits, credential-abuse controls, and API authorization rules enabled.
4. If static egress is unavailable, validate a Cloudflare Access service token at the edge; do
   not trust a plain client-supplied header.
5. Verify that an untrusted address is still challenged while the trusted QA identity receives
   the application document on every route above.

## Mobile sports navigation

The mobile sidebar exposes Live Sports as
`/sports/?bt-path=%2Flive`; the sportsbook hub exposes Football, Basketball, and Tennis with
provider-generated `bt-path` values. Keep those links keyboard-accessible and give the controls
stable accessible names or `data-testid` attributes.

Acceptance: Football, Basketball, and Tennis change `bt-path`; Live either changes it to `/live`
or is absent and declared disabled in brand capability configuration. An invisible optional Live
control is not a product defect.

## Sports metadata and H1

Render sports metadata in the first-party SSR document, outside the provider shadow root:

```html
<title>Sports Betting & Live Odds | Chacha</title>
<meta property="og:title" content="Sports Betting & Live Odds | Chacha" />
<link rel="canonical" href="https://chacha.bet/sports/" />
<h1>Sports Betting & Live Odds</h1>
```

The H1 may be visually hidden but must remain accessible and present in server-rendered HTML.
Query-string `bt-path` pages should retain `/sports/` as canonical unless SEO explicitly creates
separate indexable pages.

## BetBuilder capability 404

Do not request `/api/v1/bet-builder/brand/{brandId}/sport/{sportId}` when BetBuilder is disabled.
If the provider contract requires the request, return `200` with its documented disabled/empty
payload instead of `404`.

Acceptance: no BetBuilder `404` is emitted when the UI is absent. If the UI is present, its
capability request succeeds and BetBuilder can be opened.
