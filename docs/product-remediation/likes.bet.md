# likes.bet product remediation contract

The QA repository can detect and document these issues, but the production changes belong to
the edge, frontend, sportsbook, and casino-catalog owners. This contract defines the concrete
changes and acceptance criteria for the current desktop findings.

## WAF policy for trusted QA traffic

Cloudflare challenges currently prevent deterministic coverage of profile, cashier, casino,
live-casino, live-chat, and provider-launch routes.

1. Put only static CI/QA egress addresses in a managed `qa_egress_ips` list.
2. Add a rule before the managed challenge rule for `likes.bet` that skips the HTML-document
   bot challenge for trusted QA traffic on `/`, `/profile/`, `/assets/`, `/transactions/`,
   `/casino/`, `/livecasino/`, and `/sports/`.
3. Keep DDoS protection, rate limits, credential-abuse controls, API authorization, and all
   mutation protections enabled. Do not trust an arbitrary client-supplied bypass header.
4. If static egress is unavailable, authenticate CI with a Cloudflare Access service token and
   validate that identity at the edge.

Acceptance: the trusted QA identity receives the application HTML without a challenge on every
listed route; an untrusted address is still challenged; login and financial API authorization
remain unchanged.

## Sports metadata and H1

The current sports pages reuse a casino title and expose no suitable H1. Render first-party SSR
metadata outside the sportsbook provider surface:

```html
<title>Sports Betting & Live Odds | likes.bet</title>
<meta property="og:title" content="Sports Betting & Live Odds | likes.bet" />
<link rel="canonical" href="https://likes.bet/sports/" />
<h1>Sports Betting & Live Odds</h1>
```

The H1 may be visually hidden, but it must remain accessible and exist in the server-rendered
document. Query-string `bt-path` variants should retain `/sports/` as canonical unless the SEO
team explicitly makes individual routes indexable.

Acceptance: root, soccer, and live sports routes have a sports-specific title and H1, retain the
correct canonical, and pass the QA metadata smoke without a `product-warning` annotation.

## Sports event Back contract

Expose a keyboard-accessible event-detail Back button with an accessible name and stable
`data-testid="sports-event-back"`. Activating it must return to the previous sports list while
preserving the list route, filters, and scroll state. It must also create or consume valid browser
history so the browser Back action has the same result.

Acceptance: the event route/state differs from the list state; both the semantic Back control and
browser history can return to the list; focus is restored to the originating event card.

## Odds and betslip testability

Expose odds as real buttons with their decimal value in accessible text and stable identifiers,
for example `data-testid="sports-odd"`. Expose the betslip as `data-testid="sports-betslip"` and
the stake field as `data-testid="betslip-stake"`. Selection must be observable through
`aria-pressed`, `aria-selected`, a stable selected class, or a deterministic betslip row.

Acceptance: selecting an available odd produces a deterministic selection signal and a betslip
row; invalid stakes (`0` and `-10`) show validation and never send a wager POST; tests do not need
coordinate clicks.

## Casino provider inventory

The latest Likes inventory contains `Delulu`, `KA Gaming`, and `Winfinity`; `Hacksaw Gaming` and
`PlayTech` were absent. Keep provider slugs/names stable in the catalog API, or publish a machine-
readable enabled-provider endpoint so QA discovery can replace the maintained baseline.

Acceptance: every enabled provider returned by the catalog is targetable by name or stable ID;
disabled providers are omitted or explicitly marked disabled; the provider matrix has no stale
`provider-absent` rows after a fresh discovery run.
