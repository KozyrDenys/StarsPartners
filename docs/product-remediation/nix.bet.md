# nix.bet product remediation contract

These production-side changes cannot be deployed from the QA repository. This contract is ready
for the Cloudflare and frontend owners to apply.

## WAF policy

Native Google Chrome with its native user agent can open `/`, while document requests to
`/assets/` and `/casino/` still receive route-specific Cloudflare challenges. In the `nix.bet`
zone:

1. Create the managed IP list `qa_egress_ips` containing only static CI/QA egress addresses.
2. Place this custom rule before the challenge rule:

   ```text
   (http.host eq "nix.bet"
    and ip.src in $qa_egress_ips
    and http.request.method in {"GET" "HEAD"}
    and http.request.uri.path in {"/" "/assets/" "/casino/" "/livecasino/" "/sports/"})
   ```

3. Set the action to `Skip` only the managed-challenge/Bot Fight checks responsible for the HTML
   document challenge. Keep rate limiting, DDoS protection, credential checks, and API rules.
4. If static egress is unavailable, validate a Cloudflare Access service token at the edge. A
   plain custom header is not a safe trust signal.
5. Verify that an untrusted IP remains challenged and the trusted QA identity receives the app
   document on every listed route.

QA-side mitigation is implemented: Nix desktop runs use installed Google Chrome, do not spoof a
stale user agent, warm only `/`, and continue API-capable coverage when a protected UI route is
challenged.

## Sports navigation

No product deployment is required. The controls work and produce:

- Football: `bt-path=/football-1`
- Basketball: `bt-path=/basketball-2`
- Tennis: `bt-path=/tennis-5`

The QA selector previously clicked an identically named league fragment. It now targets the sport
control with its dynamic event count and resets to the sports hub before each assertion. `Live` is
optional because it is not exposed as a root control in every render.

## Sports metadata and H1

The indexable canonical `https://nix.bet/sports/` currently has title/OG title `Nixbet Casino`, a
correct canonical, and no H1. Apply this in the frontend SSR response, outside the third-party
shadow root:

```html
<title>Sports Betting & Live Odds | Nixbet</title>
<meta property="og:title" content="Sports Betting & Live Odds | Nixbet" />
<link rel="canonical" href="https://nix.bet/sports/" />
<h1>Sports Betting & Live Odds</h1>
```

The H1 may use the existing visually-hidden utility class, but must remain accessible and must be
present in server-rendered HTML. Query-string `bt-path` views should retain `/sports/` as canonical
unless the SEO owner intentionally creates separate indexable landing pages.

Acceptance: `/sports/?bt-path=%2F`, `%2Fsoccer-1`, and `%2Flive` have a sports-specific title, one
meaningful H1, and the `/sports/` canonical.

## BetBuilder capability 404

The sportsbook may request
`GET /api/v1/bet-builder/brand/2415957007728254976/sport/5` while no Bet Builder control is
exposed. Prefer not requesting settings when the brand/sport capability is disabled. Otherwise,
return `200` with the provider's explicit disabled/empty capability payload instead of `404`.

QA records this exact `404` as an optional-capability diagnostic only when the Bet Builder UI is
absent. It remains critical if the UI is exposed, another endpoint fails, or a response is `5xx`.

## VIP missions capability 404

The authenticated frontend requests `GET /api/v1/vip-missions`, but the endpoint currently
returns `404`. Make the frontend and API capability contract explicit:

- if VIP missions are enabled for Nix, expose the endpoint and return the documented mission
  collection with `200` (an empty collection is valid when the player has no missions);
- if the feature is disabled for this brand, do not issue the request and do not render a VIP
  missions entry point;
- do not use `404` as an empty-state response for a capability the frontend expects to exist.

Acceptance: an authenticated page load produces no `404` for `/api/v1/vip-missions`; the UI and
API agree on whether the feature is enabled, and the disabled or empty state produces no console
error.

## Empty country flag asset request

The player UI currently constructs `/flags_by_code/.svg`, which means an empty or missing country
code reaches the asset URL builder. Validate the country code before rendering the flag. When the
code is absent or unsupported, render the product's neutral placeholder (or omit the image) rather
than requesting an empty filename. Normalize valid codes to the filename convention used by the
asset bundle before constructing the URL.

Acceptance: no request is made to `/flags_by_code/.svg`; a player with a valid country receives a
working flag asset, while a player without one receives an accessible fallback without a broken
image or network error.
