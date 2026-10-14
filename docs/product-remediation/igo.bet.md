# igo.bet product remediation contract

These findings require changes in the IGO frontend, backend, catalog, or edge configuration. The
QA repository now reports them independently and no longer turns one provider challenge into
dozens of synthetic blocked rows.

## Profile details readiness

`GET /profile/details/` returns HTTP 200, but the page exposes no editable first name, last name,
city, address, email, or phone control within the normal readiness window.

- Render the profile form for an authenticated player, or remove the route/navigation entry when
  profile details are intentionally read-only.
- Keep stable `name` attributes on editable inputs and expose a labelled Save/Update submit action.
- Show an explicit empty/error state if the profile API fails instead of leaving the route without
  usable content.

Acceptance: an authenticated player can open `/profile/details/`, edit one harmless text field,
save it, reload, and observe the persisted value; required/format errors are visible and accessible.

## Avatar upload

The Account page currently exposes neither a file input nor a usable upload/save action for an
avatar. Either implement the capability or remove the avatar-edit affordance and capability claim.

Acceptance: selecting a valid PNG attaches one file, the update request returns 2xx, and the new
avatar remains visible after reload. Invalid type and oversize files receive a clear validation
message.

## Preferences persistence

No editable preference control is exposed on `/profile/preferences/`, so persistence cannot be
verified. Render at least one labelled preference control and persist it through the user
preferences API, or remove the route when the capability is disabled for IGO.

Acceptance: a preference can be changed, saved, reloaded, and restored without a 4xx/5xx response.

## Betsoft catalog mapping

Betsoft is present in the provider inventory, but applying the provider filter yields visible cards
that cannot be identified as Betsoft games. Align the provider filter identifier, card metadata,
and catalog API provider value. Every rendered card should expose a stable provider id/name (DOM
attribute or launch URL) that matches the selected filter.

Acceptance: selecting Betsoft returns at least one Betsoft game, no foreign-provider card, and a
real-money launch either opens a working game surface or a documented balance/deposit gate.

The same acceptance criteria currently apply to Fugaso and Absolute Live Gaming: both providers
are present in inventory, but their filtered catalog exposes no launchable game card.

## Favorites and recent games

The authorized casino card does not expose a discoverable favorite control, and a successfully
launched game is not linked from `/recent/` by its stable provider/slug identity during the
observation window.

- Expose a labelled favorite toggle on each eligible game card and persist its state for the
  authenticated player.
- Record successful real-money launches in recent history using the same stable game id/provider
  slug used by the launch route; do not rely only on translated display text.

Acceptance: the player can favorite/unfavorite a game with persistence after reload, and a newly
launched game appears under `/recent/` with a matching id/slug.

## Authorized live chat

The authorized sidebar does not expose a live-chat trigger in the current layout. If support chat
is enabled for IGO, render an accessible labelled trigger and preserve active/minimized states. If
the capability is intentionally disabled, remove the product capability declaration so the UI and
QA contract agree.

## Booming Games edge policy

The Booming Games launch receives a Cloudflare/Turnstile challenge. Do not broadly disable WAF.
Create a narrowly scoped rule for trusted QA egress or a signed service identity, limited to the
required launch document request. Keep rate limiting, DDoS, credential, and API protections.

Acceptance: a trusted QA browser can launch Booming Games repeatedly while an untrusted client
continues to receive the configured protection.

## Sports metadata and flag assets

Sports routes use the generic title `IgoBet Casino`, expose no meaningful H1, and request invalid
flag assets such as `/flags_by_code/undefined.svg` and `/flags_by_code/.svg`.

- Add a sports-specific SSR title and exactly one meaningful H1; retain the canonical `/sports/`
  URL unless SEO intentionally defines indexable subroutes.
- Validate and normalize country codes before building a flag URL. When no valid code exists,
  omit the image or render the accessible neutral placeholder.

Acceptance: sports hub and sport/event views have a sports-specific title, one H1, a valid
canonical, and make no empty/undefined flag request.

## Optional capabilities and API contracts

Casino/live-casino search, password change, withdrawal, and OpenAPI contract checks are currently
declared optional or lack supplied schemas. Product and QA owners must agree which are required.
For required APIs, provide versioned auth/payment OpenAPI documents through the configured QA
schema inputs; for disabled UI capabilities, do not render entry points or make capability calls.
