# booms.bet product remediation contract

The QA repository can detect these production findings but cannot deploy the edge, frontend,
sportsbook, cashier, or catalog changes. This contract defines implementation and acceptance
criteria for the current desktop run.

## WAF policy for trusted QA traffic

Cloudflare challenges prevent deterministic coverage of authenticated, profile, cashier, casino,
live-chat, and provider-launch routes.

1. Put only static CI/QA egress addresses in a managed `qa_egress_ips` list.
2. Add a rule before the managed challenge rule for `booms.bet` that skips only the HTML-document
   bot challenge for the trusted QA identity on `/`, `/profile/`, `/assets/`, `/transactions/`,
   `/casino/`, `/livecasino/`, and `/sports/`.
3. Keep DDoS protection, rate limits, credential-abuse controls, API authorization, and payment
   mutation protections enabled. Never trust a public bypass header by itself.
4. If static egress is unavailable, authenticate CI with a Cloudflare Access service token and
   validate that identity at the edge.

The runner supports `PW_EXTRA_HTTP_HEADERS_JSON` and the narrower
`PW_QA_BYPASS_HEADER_NAME`/`PW_QA_BYPASS_HEADER_VALUE` pair. Configure them only after the edge
validates the corresponding QA identity.

Acceptance: trusted QA receives application HTML without a challenge on every listed route;
untrusted traffic remains challenged; login and financial API authorization are unchanged.

## Sports event return navigation

Opening an event updates `bt-path`, but neither a semantic Back control nor browser history returns
to the list. Render a keyboard-accessible Back button with a stable
`data-testid="sports-event-back"`, and push/restore provider routes through browser history and
`popstate`. Restore the previous list, filters, scroll position, and focus on the originating card.

Acceptance: open an event from the sports list, activate the semantic Back control, and return to
the previous list with a changed URL. Repeating the flow with browser Back must produce the same
result.

## BetBuilder capability contract

The sportsbook requests `/api/v1/bet-builder/brand/2443132983943770114/sport/5` even though the
brand does not expose Bet Builder, producing a 404 and console errors. Gate the request behind the
brand/sport capability. If the capability is enabled, return a documented 200 response; if it is
disabled, do not issue the request and keep the console clean.

Acceptance: navigating across the sports root, live, football, basketball, and tennis creates no
BetBuilder 404 response and no BetBuilder console error when the UI capability is absent.

## Country flag fallback

The sportsbook currently requests `flags_by_code/undefined.svg`. Validate the country code before
building the asset URL and render an accessible neutral flag when it is absent or unsupported.

Acceptance: no flag request contains `undefined` or `null`; rows without a country code display a
neutral fallback with a non-empty accessible label.

## Sports metadata and H1

Render first-party metadata in the server document, outside the sportsbook provider surface:

```html
<title>Sports Betting & Live Odds | booms.bet</title>
<meta property="og:title" content="Sports Betting & Live Odds | booms.bet" />
<link rel="canonical" href="https://booms.bet/sports/" />
<h1>Sports Betting & Live Odds</h1>
```

The H1 may be visually hidden but must remain accessible and server-rendered. Query-string
`bt-path` views should keep `/sports/` as canonical unless SEO defines indexable landing pages.

Acceptance: sports root, soccer, and live views expose a sports-specific title, one meaningful H1,
and the `/sports/` canonical.

## Casino provider inventory

Review `100hp`, `CT Interactive`, `Delulu`, `Swintt`, and `Winfinity`. Enabled providers must be
returned with stable IDs/slugs and be visible to the tested country, currency, and account tier;
disabled providers must be omitted or explicitly marked disabled.

Acceptance: a fresh provider discovery has no unexplained `provider-absent` rows, and every enabled
provider can be targeted without display-name heuristics.

## OpenAPI contract inputs

Publish versioned, access-controlled Auth and Payment OpenAPI documents to QA and configure their
locations through `QA_AUTH_OPENAPI_URL` and `QA_PAYMENT_OPENAPI_URL`, or provide equivalent local
files under `contracts/openapi/`. Missing schemas are a failure in strict contract mode.

Acceptance: Spectral and Schemathesis both execute against Auth and Payment schemas; neither check
is reported as blocked, partial, or not applicable.

## Cashier and live-chat acceptance after WAF remediation

After the trusted QA route is available, the deposit UI must expose all applicable methods returned
by `/api/payment/getPaySystems`, including readiness and submit-state evidence, without sending a
payment. Live chat must expose its pre-chat controls and allow controlled guest and authorized test
messages in the designated QA support queue.

Acceptance: Deposit is no longer `api-only`; method/UI reconciliation passes; both live-chat flows
produce message-send evidence and the configured reply expectation.
