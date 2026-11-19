---
title: 'ADR 0014: Web Application Design'
description: Decision record for the React single-page application, Tailwind styling, static serving, API bindings, authentication integration, recovery, and quality gates
author: Tim Park
ms.date: 2026-11-09
ms.topic: concept
subsystems:
  - webapp
keywords:
  - adr
  - webapp
  - react
  - vite
  - tailwind
  - authentication
estimated_reading_time: 20
---

## Status

Accepted on 2026-10-20. Resolves the web application framework follow-up in
[ADR 0010](./0010-monorepo-layout-and-subsystem-boundaries.md).
The [scaffold](../../webapp/README.md) delivers the toolchain and shell;
the delivered [UX foundation](../../webapp/ux-reference.md) establishes
styling and navigation, the delivered
[sign-in](../../webapp/README.md#sign-in) adds authentication and API
bindings, and
[ADR 0015](./0015-web-application-ux-and-styling.md#delivery-and-boundaries)'s
journey stories deliver portfolio views and the first writes.

This decision does not create `webapp/` or change the service contract.
Authentication delivery was blocked until the SDK compatibility checkpoint
below passed; the [checkpoint outcome](#checkpoint-outcome) amends this
decision with the reviewed patch it required, on 2026-10-25. Selecting an SDK
is not evidence that its defaults satisfy our refresh and logout contracts.
The [chart checkpoint outcome](#chart-checkpoint-outcome) amends it on
2026-10-26 with application-owned SVG for the first chart. The delivered
[ledger editing](../../webapp/README.md#ledger-editing) implements the write
pipeline and recovery below, and the
[headless component checkpoint outcome](#headless-component-checkpoint-outcome)
amends this decision on 2026-10-29 with native radio groups for its choices.
The delivered [portfolio setup](../../webapp/README.md#portfolio-setup)
extends the same pipeline to account, investment, scenario, market-link,
property, and price-series writes, including deletions' empty `204`
answers, and lets a draft defer the post-commit refresh only when a
dependent change or a navigation refreshes the views instead.
Amended on 2026-11-06 with [reload restoration](#reload-restoration): a tab
that signed in and validated its service session may restore after a reload
through one top-level `prompt=none` redirect, distinct from explicit
reauthentication after a failed or expired session.

## Context

The web application is a thin, client-rendered HTTP client. The service owns
business validation, authorization, calculation, and persistence. Preserve
[ADR 0002](./0002-financial-primitives-and-identifiers.md)'s canonical strings,
[ADR 0008](./0008-http-api-contracts.md)'s browser and mutation contracts, and
[ADR 0009](./0009-authentication-and-initial-tenancy.md)'s Auth0 single-page
architecture and in-memory tokens.

Contributors need maintained TypeScript tooling, accessible forms and tables,
and documented patterns that also support later allocation and simulation
views. Browser state must not invent financial meaning, conceal an uncertain
write, or replay a mutation after authentication changes.

## Considered Options

### Framework and tooling

| Framework   | Strengths                                                          | Trade-offs and outcome                                                |
|-------------|--------------------------------------------------------------------|-----------------------------------------------------------------------|
| React       | Broad forms, tables, charts, testing, and Auth0 ecosystem; TSX     | More routing/state choices and a larger baseline than Solid; selected |
| Vue         | Typed single-file components, official router, Auth0 wrapper       | Strong alternative; React's component and testing ecosystem preferred |
| Svelte      | Compiler-led small runtime, concise components, TypeScript         | More custom Auth0 integration and fewer shared React examples         |
| Angular     | Integrated typed forms, router, CLI, testing, and Auth0 wrapper    | More framework conventions and baseline machinery than this SPA needs |
| Solid       | Fine-grained updates, small runtime, TypeScript/JSX                | Smaller component, chart, and Auth0 integration ecosystem             |

All five have maintained release streams; none is selected on a promise of
permanent API stability or an unmeasured bundle-size ranking. React's
documentation, Testing Library examples, and component ecosystem reduce
integration work for contributors and coding agents. Vue is the closest
alternative. Svelte and Solid can use the generic Auth0 SPA SDK, but do not
gain React's first-party wrapper option. Angular's integrated release and
migration tooling is useful for a larger application, not a requirement here.

Security history is a reason to pin and review updates, not to label one
framework safe. React's
[Server Components advisory](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components)
illustrates the cost of unnecessary server features: those packages and
endpoints are excluded here. Browser XSS and vulnerable build tools still
matter. Review framework, Vite, plugin, and transitive advisories at adoption
and on updates; loopback-only development is not an exemption.

Choose Vite over a hand-built bundler pipeline, Parcel, or Rsbuild for its
React/TypeScript integration, Tailwind plugin, development server, and shared
Vitest configuration. React has no mandatory build server. Do not add Next.js,
React Server Components, SSR, or React Router's framework server. React Router
in declarative library mode supplies routing without a second data cache or
server runtime.

### Other architectural choices

| Area           | Selected approach                           | Alternatives and rationale                                                                                 |
|----------------|---------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Styling        | Tailwind CSS with native semantic HTML      | CSS Modules needs more local styling conventions; CSS-in-JS complicates CSP                                |
| Components     | Small application-owned components          | A full UI kit adds unused components; headless primitives wait for a concrete need                         |
| API bindings   | Generated types and response validators     | Full generated clients hide transport/retry choices; handwritten DTOs duplicate the contract               |
| Server state   | TanStack Query                              | React state/effects require manual cache, pagination, and cancellation coordination                        |
| Auth SDK       | `@auth0/auth0-spa-js` behind one adapter    | The React wrapper adds lifecycle behavior without removing the underlying SDK compatibility gate           |
| Static server  | Caddy                                       | Vite preview is not a release server; a custom Node server adds file-serving code to maintain              |
| Recovery       | Tab-scoped pending-intent journal           | Memory loses intent on redirects; localStorage/IndexedDB retain financial payloads longer than needed      |
| Quality        | ESLint, Prettier, Vitest, Playwright        | Biome and browser-only component runners offer fewer benefits than the selected React rules and test reuse |

## Decision Outcome

### Language, build, and routing

Use React, Vite, React Router, and TypeScript with `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
`useUnknownInCatchVariables`. Use Vite-compatible ES modules and bundler
resolution, isolated module compilation, and separate browser and Node tooling
configurations. Vite transpilation does not replace `tsc --noEmit`.

Pin Node.js `24.22.0` in `webapp/.node-version`, the verified Node 24 LTS release
at acceptance. The development-container installer, CI's Node setup, and host
setup read that file; do not repeat an independently maintained version in
their configuration. Use its bundled npm and verify Node/npm in the toolchain
check. Updates change the one pin and run the complete webapp suite. Node 26
is still Current at acceptance, so do not select it ahead of LTS.

`webapp/package.json` and `webapp/package-lock.json` stay inside the subsystem.
Build static assets into `webapp/dist/`. The initial shell contains only
working navigation, a landing page, and a not-found route. Authentication adds
`/auth/callback` and a logout return to `/`; do not show a nonworking login
control in the scaffold. Allow only application-local return paths, never a
caller-supplied external redirect. Route changes update the title and focus.

Support current and previous stable desktop Chrome/Edge, Firefox, and Safari,
with responsive layouts. The scaffold records tested versions and aligns
Vite's build target with them. Tailwind v4's minimum browser features are a
floor, not a promise to support every browser since that floor. Test exact
string number formatting, half-even display rounding, Web Crypto, and workers
in all three Playwright engines. An unsupported capability produces a clear
unsupported-browser state, never a floating-point or token-storage fallback.

### Origins, serving, and content security policy

Use exactly `http://localhost:5173` for development and built local serving,
`http://localhost:5173/auth/callback` for the callback, and
`http://localhost:5173/` for the logout return. Choose `localhost` deliberately;
`http://127.0.0.1:5173` is not an alias in browser or Auth0 configuration.
Keep the API at its separately configured loopback origin, initially
`http://localhost:8080`, and reserve 8081 for the agent DevUI.

Both servers bind only loopback, accept only the configured authority, and
fail when port 5173 is occupied rather than selecting a different port. Run
only one at a time. Reject non-loopback host resolution and unapproved Host
headers; do not enable Vite's unrestricted host allowlist or expose either
server through a tunnel.

Use Caddy as a static file server, not a proxy or backend-for-frontend. The
scaffold adds a checked-in Caddy configuration and an exact
`webapp/.caddy-version` pin, consumed by CI, container, and host setup, with
verified release checksums. Disable Caddy's administration listener, automatic
HTTPS for this explicit HTTP site, directory browsing, and request access
logging. Serve only `dist/`, reject symlinks escaping it, and keep secrets,
source maps, source files, and configuration inputs outside the served tree.
Serve the SPA document for application navigation, including the callback;
missing asset requests must remain 404, not HTML. Do not proxy `/api`.

The release server emits this policy as an HTTP header. The example issuer
origin is a placeholder replaced only by the validated, exact configured
HTTPS Auth0 origin; do not allow wildcards or the whole `https:` scheme.

```text
default-src 'none';
script-src 'self';
script-src-attr 'none';
style-src 'self';
style-src-attr 'none';
img-src 'self';
font-src 'self';
connect-src 'self' http://localhost:8080 https://login.example.test;
worker-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

The unauthenticated scaffold uses only `'self'` in `connect-src`; it does not
configure an unused API or issuer. The authenticated build adds only its exact
API and issuer origins. Authentication uses top-level redirects, not embedded
login frames. Bundle scripts, Tailwind CSS, icons, and any fonts locally.
Prohibit third-party scripts, analytics, remote fonts, CDNs, dynamic code
evaluation, inline handlers, and runtime style injection. Set Vite's
`build.assetsInlineLimit` to `0` rather than permitting `data:` resources.
Load the SDK's version-matched production worker from the webapp origin using
`workerUrl`, not a CDN or a blob URL. Serve the worker with a matching policy
that restricts its connections to the issuer.

Vite development needs its same-origin HMR WebSocket and injected style/script
elements. Permit only `ws://localhost:5173` in development `connect-src`, and
give Vite's injected elements and React Refresh preamble a fresh per-response
nonce. Use Vite's `html.cspNonce` placeholder with development middleware that
replaces it after HTML transformation and pairs it with the response header.
Never use a fixed nonce, `'unsafe-inline'`, or `'unsafe-eval'`. This nonce/HMR
exception exists only in development; the Caddy-served build has external
scripts/styles and no nonce placeholder or WebSocket allowance. The scaffold
must prove both policies work, including HMR, rather than disabling CSP.

Also send `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, and a Permissions Policy disabling camera, microphone,
and geolocation. Use `Cache-Control: no-store` for HTML and public runtime
configuration, and immutable caching only for content-hashed assets.
Configuration contains public issuer/client/audience/origin values, never a
secret. Validate it before use and generate CSP from the same values.
No service worker or offline portfolio cache is installed. HTTPS, HSTS, hosted
origins, and any BFF remain with the
[Kubernetes decision](../backlog/adr-kubernetes-hosting-and-public-exposure.md).

### API bindings and exact data

Generate checked-in TypeScript types with `openapi-typescript` from the
[OpenAPI description](../../service/crates/portfolio-http/openapi.json).
Use a small application-owned fetch adapter rather than a generated transport
or Axios. It returns typed data together with status and the exposed `ETag`,
`Location`, `X-Request-ID`, `Idempotency-Replayed`, `WWW-Authenticate`, and
`Retry-After` headers, including on errors. Preserve bodyless 204 responses.

Types alone do not validate responses. Generate standalone response validators
with Ajv's JSON Schema 2020-12 support at build time, using the description's
response schemas and local references. Do not compile schemas in the browser:
standalone code avoids an `eval`/`Function` CSP exception. Test the OpenAPI
dialect's annotations and discriminators against the selected generator;
preserve validation semantics rather than silently dropping unsupported
keywords. Do not coerce types, inject defaults, remove fields, or reject
additive optional response fields the contract permits.

Decode JSON as `unknown` before validation. Invalid shapes or unsupported
closed enums produce a visible compatibility error and disable affected
operations. Do not map them to another variant, omit a row from a total, or
render a partial valuation as complete. Service field errors remain
authoritative; browser checks are advisory and do not duplicate domain rules.

Keep financial decimals, rates, quantities, currencies, dates, IDs, epochs,
and opaque validators as strings. Never route them through JavaScript
`number`, `parseFloat`, numeric input coercion, or JSON numeric fields.
Prefer service-computed values. For display sorting, compare validated
decimal strings using signed `bigint` coefficients scaled to a common
decimal scale; this is exact within ADR 0002's bounds and needs no decimal
package. Compare only compatible units/currencies, and do not calculate
portfolio totals or FX conversions in the browser.

Use `Intl.NumberFormat` with exact string input and explicit display precision
and `roundingMode: "halfEven"`. Currency display includes the currency code;
display rounding never changes a saved value. Keep any TypeScript declaration
gap in one tested formatting boundary, not an unsafe cast at every call site.
Keep the original canonical string in form state and use text inputs with
appropriate `inputMode`. Reject noncanonical submitted spelling rather than
normalizing it into acceptance. A display-only date conversion uses
`Intl.DateTimeFormat` with the Gregorian calendar and UTC, so a calendar date
cannot shift a day with the user's timezone. Instants show a labelled zone.

`npm run api:generate` deterministically regenerates types and standalone
validators. `npm run api:check` generates into a temporary directory and
compares the entire output inventory and contents with checked-in artifacts,
failing on missing, stale, extra, or changed files. It never repairs CI's
working tree. Pin generators; ignore timestamps and machine paths by not
emitting them. The authenticated story adds the OpenAPI path to the webapp CI
filter and tests precision boundaries, null versus omission, optional fields,
unknown enums, and a deliberately stale generated artifact.

### State, writes, and recovery

Use TanStack Query for server state and React state/context for local UI and
authentication status. Do not add Redux, a second fetch cache, query-cache
persistence, optimistic financial updates, or an offline mutation queue.
Scope cache keys to service origin, authenticated subject, tenant, epoch,
resource, filters, and cursor. Clear and cancel caches on logout, identity
change, or tenant epoch change, and fence late responses from the old session.
Render cursors as opaque pagination controls, not offset arithmetic.

Store validators with the response. An edit captures the ETag for its exact
target and the session's epoch; background reads must not replace these
preconditions inside an open form. Disable automatic query retries initially;
explicit read refreshes may respect bounded `Retry-After` guidance. Set
mutation `retry: false` and disable pause/resume or reconnect replay, including
TanStack's offline behavior. An offline write fails visibly before dispatch,
or becomes an unknown outcome if dispatch may already have happened.

The transport attaches only an access token to the API with
`credentials: "omit"`, `redirect: "error"`, bounded response sizes, and a
bounded abort timeout. No interceptor, authentication renewal, router action,
or component effect may retry a mutation. A timeout or cancellation after
dispatch is not proof of rollback.

Before dispatch, save a versioned immutable write intent: method, target,
query, original canonical payload, quoted `Idempotency-Key` generated once
with `crypto.randomUUID()`, saved tenant epoch, and required `If-Match`.
Public publications use their separate receipt namespace and no tenant epoch
header, as ADR 0008 requires. Disable duplicate submission while unresolved.

Keep only unresolved intents in tab-scoped `sessionStorage`, keyed by issuer,
client, verified subject, service origin, tenant, and operation key.
Persisting these financial payloads is an explicit trade-off: a redirect or
reload must not lose the exact request needed to reconcile an uncertain
write. Do not store portfolio read caches, unrelated drafts, tokens, or
Authorization headers there, in localStorage, or in IndexedDB. Version and
validate the journal on read, bound entries by the API's request limits, and
handle quota/unavailable-storage errors before sending: block the write and
explain that recovery storage could not be saved. Never silently downgrade to
memory-only recovery. Browser storage is not confidential or a durable backup.

On return from login or reload, verify the identity and `/api/v1/session`
before showing a journal entry. Different subjects or tenants cannot inherit
another user's intent. Opening or duplicating a tab must not trigger replay;
use `noopener` for app-opened tabs and treat any copied journal as
reconciliation-only until an explicit user decision.

After an unknown outcome, offer receipt lookup in the correct namespace and,
only on explicit confirmation, an identical resend with the same key and
fingerprint. A 404 receipt is not proof of rollback. A committed result is
historical; fetch current state before another edit. Stale ETags require a
fresh read and user decision. On epoch change, clear cached data and block old
intents from resending; never substitute the new epoch. Explain that a tenant
reset or restore requires reconciliation before any new intent.

Remove intent payloads after a resolved outcome or explicit discard. Warn
before logout or discard if outcomes remain uncertain; offer the operation
key for later operator-assisted receipt lookup, not a financial-payload
download. Logout clears the journal and all portfolio state. Closing the tab
can lose the journal, and browser session restoration may retain it; document
both limits without promising secure erasure.

### Authentication and session lifecycle

Use one `@auth0/auth0-spa-js` instance behind a typed application adapter.
The SDK owns PKCE S256, state, nonce, token validation, and token lifecycle;
components do not implement OAuth or inspect refresh tokens. Avoid duplicate
callback exchange under React Strict Mode. Use authorization-code redirects,
`cacheLocation: "memory"`, `useRefreshTokens: true`,
`useRefreshTokensFallback: false`, and the rotating offline refresh-token
mode, not the newer nonrotating online mode. Do not supply a persistent custom
cache. Keep the production SDK worker self-hosted and version-matched.

SDK transaction state, nonce, and PKCE verifier may live briefly in
sessionStorage across the redirect; they are not cached tokens. Clean up
transactions after callback success or failure, remove callback query
parameters with history replacement, and do not log the callback URL. SDK
session-hint cookies are not authentication or permission to skip validation.
Never place access, ID, or refresh tokens in browser storage, cookies, or URLs.

Serialize refreshes per credential family and request only the configured
audience/scopes. Configure Auth0 rotation, reuse detection, zero grace, the
8-hour idle and 24-hour maximum SPA refresh lifetimes, and the 900-second
access-token lifetime from ADR 0009. Do not run background renewals merely to
keep an idle session alive. Provider enforcement is authoritative; browser
timers do not extend a family lifetime.

A reload loses the token cache. A tab that signed in may restore through
one top-level Auth0 redirect, as [reload restoration](#reload-restoration)
describes; otherwise it signs in again. Do not attempt a hidden-iframe or
storage fallback, a persistent SDK cache, or a silent-token call that
pretends to recover the destroyed worker's refresh token. Each tab has its
own in-memory family; tokens never cross tabs. Use `BroadcastChannel` only for
token-free logout and invalidation signals, not credentials, payloads, or a
shared refresh-token store. Resume from a suspended tab requires fresh session
validation before enabling writes.

Authentication challenges and expiry lock protected actions and initiate an
explicit re-authentication flow; reload restoration never starts after them.
A 403 permission denial is not a refresh loop and starts no authentication.
An ambiguous refresh invalidates the family locally and requires login;
never resubmit its old refresh token. Re-authentication preserves the saved
write intent but never replays it, changes its guards, or grants permission to
send it as a new operation.

Logout stops new work and coordinates with any in-flight refresh before
calling the SDK's `revokeRefreshToken()` for the configured audience. Then
clear local state and call `logout()` to end the Auth0 session with the
allowlisted return URL. These are separate operations: local logout or the
logout redirect is not refresh-grant revocation. On revocation failure, still
clear local state, report that remote revocation was not confirmed, and retain
only a non-secret status across the logout redirect. Never report success for
an unconfirmed revocation.

#### Reload restoration

After an explicit sign-in and a successful `/api/v1/session` read, the
adapter saves a versioned, token-free hint in the tab's `sessionStorage`,
scoped to the issuer, client ID, and service URL, with the original
interactive sign-in time and the last token time. It records only that a
reload may attempt restoration. It never says who is authenticated or what
they may do; identity, permissions, tenant, and epoch come from the new
callback and a fresh `/api/v1/session` read before data or writes are
enabled. Missing, malformed, foreign, expired, or unavailable storage
disables restoration and leaves explicit sign-in working; failing to save
the hint is shown in Account.

On a non-callback load with an eligible hint, the adapter enters a restoring
state shown by both Account and the protected-route gate before anything
else renders. It records the attempt and the application-local return path
in the hint, then calls the SDK's `loginWithRedirect` with
`authorizationParams.prompt: 'none'`, the configured audience and scopes, and
the return path in `appState`, replacing the current history entry. This is
a brief top-level navigation, not an iframe. The callback is processed once,
with the SDK's state, nonce, PKCE, and ID-token validation, and consumes the
hint whatever the outcome. A load that finds an attempt outside the callback
was interrupted and does not retry; a document returned from the browser's
back/forward cache while redirecting ends the same way. Only a later
validated session saves the hint again, so no reload, Back, or Strict Mode
remount repeats an automatic redirect or exchange. Explicit Sign in never
sends `prompt=none`, and restoration never escalates to interactive login.

`login_required`, `consent_required`, `interaction_required`, and
`mfa_required` mean an explicit sign-in is needed. Provider or network
unavailability, offline operation, denial, and invalid callbacks are
reported separately with the existing safe messages. The token worker
returns a failed or timed-out exchange to the SDK as a plain error message,
so the SDK client restores those transport failures to their types before
the adapter classifies them. Each returns to the
requested route, where Sign in uses the normal interactive flow.

The restored session keeps the original sign-in time, and a hint past the
8-hour idle or 24-hour maximum lifetime ends with "Session expired" without
contacting the provider, so a reload never extends the window. These hints
can only suppress restoration; ADR 0009's bounded Auth0 SSO session enforces
the limit. Explicit logout, logout in another tab, expiry, rejected
credentials, and ambiguous refresh remove the hint before anything else, so
suppression survives a failed revocation or provider logout. Explicit
logout also replaces a random, token-free logout marker in `localStorage`,
and the hint records the marker its session began with. A tab that missed
the broadcast, because it was at the provider or the browser discarded it,
finds the marker changed on its next load or callback: it does not restore,
leaves the code unexchanged, and runs the same logout cleanup, including
the pending-write journal. Storage that cannot hold or read the marker
disables restoration. A callback that completes after another tab's logout,
or a restoration callback the tab no longer expects, is fenced: its new
family is revoked and cleared and the tab stays signed out. First visits and
tabs without a hint make no provider request. Cross-tab session hydration
and survival of browser closure are not provided.

#### SDK compatibility checkpoint

The inspected
[Auth0 SPA SDK v2.28.4](https://github.com/auth0/auth0-spa-js/releases/tag/v2.28.4)
provides PKCE, memory caching, a self-hosted worker option, disabled iframe
fallback, and an explicit revocation method. However, its
[HTTP helper](https://github.com/auth0/auth0-spa-js/blob/v2.28.4/src/http.ts)
retries network failures, and its
[token worker](https://github.com/auth0/auth0-spa-js/blob/v2.28.4/src/worker/token.worker.ts)
retains the old refresh token on a network failure or timeout. Disabling
`useRefreshTokensFallback` does not disable those retries.

The authenticated web application story owned a blocking checkpoint before
login was enabled. Pin and inspect the then-selected SDK release and prove,
with a fake provider that consumes a refresh and drops the response, that the
old token is submitted exactly once and that the UI requires a new login. Test
worker and non-worker paths, concurrent callers, revocation failure, and
absence of token persistence under the release CSP. If upstream still violates
this contract, record a reviewed, narrowly maintained patch or a replacement
SDK in an amendment here, including version, distribution, supply-chain
handling, and test evidence. Do not hide retries with a global fetch monkey
patch, disable rotation, add a grace period, or ship an unverified refresh
flow.

#### Checkpoint outcome

Amended on 2026-10-25. Version 2.28.4 was still the latest release when
authentication was delivered, and its behavior was unchanged: `getJSON`
makes up to three attempts after a network failure or timeout, and the
worker keeps the submitted refresh token for each attempt. A fake provider
that consumed the token and dropped the connection saw it twice and revoked
the family through reuse detection in Chromium, Firefox, and WebKit.

The web application keeps `@auth0/auth0-spa-js` 2.28.4, installed exactly
from the npm registry proxy with its lockfile integrity, and applies one
reviewed patch to the SDK's own shipped worker source,
`src/worker/token.worker.ts`. [config/auth0-worker.ts](../../webapp/config/auth0-worker.ts)
pins that file by SHA-256 digest and the SDK by version, applies each
replacement exactly once, and fails the build if either differs. Vite bundles
the result as the self-hosted, same-origin `token-worker` asset passed as
`workerUrl`; the development server answers the same URL with the patched
worker bundled as one classic script, because the SDK starts a classic
worker. The patch evicts the submitted refresh token whenever its
outcome is unknown: a rejected fetch, a timeout, or an unreadable response.
The deadline covers both response headers and complete JSON consumption.
A stalled body aborts the request and evicts the submitted token; a late
response cannot restore it after that deadline.
The SDK's later attempts then find no token and fail with
`missing_refresh_token` without contacting the provider, and the adapter
treats any renewal failure other than a definite `invalid_grant` as an
ambiguous refresh that clears the family and requires a new login. Rotation,
reuse detection, and the zero grace period are unchanged, and no global
`fetch` is patched. An SDK update fails the build until the patch is reviewed
against the new source and this evidence is repeated.

The non-worker path is not supported. Without a worker the SDK keeps the
refresh token on the main thread and retries with it, so the application
requires Web Workers, Web Crypto, `BroadcastChannel`, and Web Locks and shows
an unsupported-browser explanation instead of Sign in. A test removes
`Worker` and confirms no provider request is made.

Evidence, from the webapp's automated suites:

* [config/auth0-worker.test.ts](../../webapp/config/auth0-worker.test.ts)
  drives the patched worker's message handler as the SDK does, three times
  per renewal, and proves one submission after a rejected fetch, a timeout,
  and an unreadable response, normal rotation, and refusal of other URLs.
  Stalled-body tests cover code exchanges and refreshes, abort propagation,
  and late responses that must not populate the token store.
  Removing the eviction makes the failure and timeout tests fail.
* The [sign-in tests](../../webapp/README.md#sign-in-tests) run the release
  build under the release policies in all three engines. When the fake
  provider consumes a refresh and drops the connection, it observes exactly
  one submission and no reuse, the workspace locks with "could not be renewed
  reliably", and no API request is sent. With the patch removed, the same
  test observed two submissions and reuse detection in every engine.
* [src/auth/auth0.test.ts](../../webapp/src/auth/auth0.test.ts) signs in
  with the real SDK client as the application configures it, running the
  patched worker in-thread, and proves that three concurrent callers, each
  with the SDK's retries, submit an ambiguous refresh token once. The SDK's
  lock serializes them, and each later caller finds no token. Removing the
  eviction makes this test fail.
* The adapter fences late results by session generation and waits for
  in-flight renewals, including their error handling, before revocation at
  logout. A renewal failure remains unconfirmed even if the SDK's subsequent
  revocation call succeeds without a token to send. React Strict Mode mounts
  twice, and the callback is exchanged once.
* Logout calls `revokeRefreshToken()`, then clears state and calls
  `logout()`. A failed revocation is reported as unconfirmed, and the
  provider session still ends. Sentinel tokens from the fake provider never
  appear in storage, IndexedDB, cookies, URLs, console output, or API request
  bodies.

If browser storage cannot retain an unconfirmed-revocation warning, logout
clears local credentials and cached data first, then displays the warning.
The user must choose "Continue to provider sign-out" before the redirect;
no token or warning is added to a URL, and the registered return remains `/`.
Tests cover unavailable storage, quota errors, and writes that do not persist,
plus keyboard and accessibility checks in both appearances.

One limit remains outside any application or SDK code. When a refresh is
sent on a reused keep-alive connection that closes before any response
bytes, Chromium and Firefox resend the request once at the HTTP layer, as
they do for any request on a stale connection. Provider reuse detection then
revokes the family; the application still treats the refresh as ambiguous
and requires a new login, so the session fails closed. A browser test
covers this case and accepts either one submission or two with reuse
detected.

The fake issuer uses a throwaway self-signed certificate that only the
authenticated browser contexts accept with Playwright's `ignoreHTTPSErrors`.
The disposable service reads the fake issuer's keys from a file through a
test-only example, so the production verifier's HTTPS trust is unchanged.

### Presentation and accessibility

[ADR 0015](./0015-web-application-ux-and-styling.md) extends these conventions
with information architecture, semantic visual tokens, dark and light
appearances, density targets, and the canonical Account disclosure. Its
foundation story adds working appearance preferences before authentication,
not a nonworking login control.

Use Tailwind CSS v4 through `@tailwindcss/vite`, emitting static CSS.
Keep theme tokens in the application stylesheet and compose statically
discoverable utility classes; do not construct class names from API data.
Use native labelled controls, semantic tables, and small reusable React
components. Plain CSS remains available for rules utilities cannot express;
do not add CSS Modules, Sass, a runtime CSS-in-JS library, or a Tailwind CDN.

A full component kit such as MUI would accelerate complex controls but adds
styling/runtime integration and unused surface. Headless primitives such as
Radix can help with complex widgets but still need CSS and accessibility
verification. The first story that needs such a widget owns selection of
any such dependency before adding it, with keyboard, focus, bundle, and
strict-CSP tests. Native tables and forms do not need a table or form library
by default.

Target WCAG 2.2 AA. Use ESLint's JSX accessibility rules and Playwright with
`@axe-core/playwright`, checking WCAG A/AA tags through 2.2 with zero
violations on each route and meaningful loading, error, dialog, and validation
state. Test keyboard-only operation, focus restoration, visible focus, error
association and summaries, zoom/reflow, and reduced motion. Manual
screen-reader and contrast checks remain release requirements; automated
checks do not prove conformance.

Show service errors by stable `code`, with safe descriptions and a copyable
request ID. Associate authoritative field errors with their inputs, and
handle unfamiliar codes by HTTP status without inferring retry permission.
Do not put tokens, financial payloads, raw provider errors, raw URLs, or query
strings in console output, telemetry, or diagnostics.

Defer charts until a chart-bearing view is ready. The
[allocation home](../../webapp/README.md#allocation) owned the checkpoint
before the first allocation chart.
Compare maintained React-compatible libraries for keyboard/screen-reader
support, exact labelled values, bundle impact, license, and CSP behavior.
Keep an accessible table/text equivalent and never use chart coordinates as
financial data. Add no chart dependency to the scaffold.

#### Chart checkpoint outcome

On 2026-10-26 the allocation home compared maintained React charting
libraries, such as Recharts, visx, Nivo, and Chart.js, with application-owned
SVG for its actual-against-target bars:

| Criterion     | Maintained library                                                                                                                                                                      | Application-owned SVG                                                                                  |
|---------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| Accessibility | Canvas output has no readable values; SVG output needs per-library work to expose labels and keyboard behavior                                                                          | Values are ordinary HTML text beside hidden bars, and the table stays authoritative                    |
| Strict CSP    | Responsive containers, tooltips, and animation set inline styles; CSP permits them through the CSSOM, but they leave `style` attributes the guide forbids and the browser suites reject | Static Tailwind classes and SVG geometry attributes only; no violation in Chromium, Firefox, or WebKit |
| Exact values  | Scales take JavaScript numbers                                                                                                                                                          | Each bar's width is the weight's exact percentage text on a 0-to-100 view box                          |
| Maintenance   | A dependency tree to review on every update, often with d3 modules and animation libraries                                                                                              | About 100 lines of application code with component and browser tests                                   |
| License       | MIT or Apache-2.0                                                                                                                                                                       | None                                                                                                   |
| Bundle cost   | The library and its dependencies in the main bundle                                                                                                                                     | No dependency; the component adds a few kilobytes before compression                                   |

Choose application-owned SVG. Two bars per class need no scales, axes,
interaction, or animation, so a library would add surface without a
capability the view uses. A later chart that needs those, such as stacked
allocation history, repeats this comparison before adding a dependency.

Amended on 2026-11-09 by
[ADR 0031](./0031-web-charting-implementation.md): measured custom and D3
prototypes select application-owned SVG for bounded, unconnected price
observations with exact endpoint labels. This does not change the bars
decision above. Later checkpoints reuse applicable evidence and compare
new capabilities or changed versions; stacking, signed performance lines,
generated ticks, and interactive markers remain unverified.

#### Headless component checkpoint outcome

On 2026-10-29 the ledger editing story compared maintained headless
primitives, such as Radix UI, React Aria, Headless UI, and Ariakit, with
native controls for its choices: the investment a purchase buys, the account
a transfer reaches, a disposition's kind, a correction's reason, and which
change to make.

| Criterion     | Headless combobox or listbox                                                                                        | Native radio group                                                                   |
|---------------|---------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| Accessibility | Correct roles and keyboard handling, but each widget needs its own focus, announcement, and error-association tests | Labelled radios with built-in arrow-key movement; one `radiogroup` carries the error |
| Strict CSP    | Floating popups are positioned with inline styles, which leave the `style` attributes the browser suites reject     | Static Tailwind classes only; no violation in Chromium, Firefox, or WebKit           |
| Exact values  | Options are entity IDs either way                                                                                   | Each radio's value is the entity ID; nothing is parsed                               |
| Maintenance   | A dependency tree to review on every update                                                                         | A small `ChoiceField` component with component and browser tests                     |
| Bundle cost   | The library and its positioning dependencies in the main bundle                                                     | No dependency                                                                        |

Choose native radio groups, rendered by `ChoiceField` in
[src/presentation/fields.tsx](../../webapp/src/presentation/fields.tsx).
A household's investments and accounts fit in a list, a native select still
reports a policy violation in WebKit, and a filtered combobox adds no
capability these forms need. The editing suite runs axe in both appearances
on each form, with and without errors, in all three engines under the
release policy. A later view whose choices outgrow a radio group repeats
this comparison, first considering a text filter above the group, before
adding a dependency.

### Quality gates and dependency staging

The scaffold adds these dependencies only when used by its shell and tests:

* Runtime: `react`, `react-dom`, and `react-router`
* Build: TypeScript, Vite, `@vitejs/plugin-react`, `tailwindcss`,
  `@tailwindcss/vite`, and the required Node/React type packages
* Static checks: ESLint with JavaScript, TypeScript, React Hooks,
  React Refresh, and JSX accessibility rules; Prettier with its Tailwind
  class-ordering plugin
* Unit/components: Vitest, jsdom, React Testing Library, user-event, and
  jest-dom
* Browsers: Playwright and `@axe-core/playwright`; Caddy is a separately
  pinned executable, not an npm runtime

Authentication adds `@auth0/auth0-spa-js`, `@tanstack/react-query`,
`openapi-typescript`, build-time Ajv standalone generation, and MSW for Node
test request interception. Do not install these in the scaffold without a
consumer. Generated validators may need a minimal pinned runtime helper;
verify the emitted bundle contains no schema compiler or dynamic evaluation.
No decimal, chart, full UI kit, state-store, or form package is preapproved.

Vitest and Testing Library test observable component behavior and pure
adapters. Use `msw/node` with unhandled requests treated as failures for API
fault fixtures; do not ship its browser worker. Playwright runs Chromium,
Firefox, and WebKit against Caddy-served release assets and separately tests
the Vite CSP/HMR path. Browser tests assert response headers, absence of CSP
violations, and denial of prohibited resources; no test disables web security
or bypasses CSP. The scaffold has no external network calls at startup.

Authenticated end-to-end tests use a disposable service in authenticated
local mode, synthetic tenants, and a fake OIDC provider with local signing
keys, discovery/JWKS, authorization, token, revocation, and logout endpoints.
Use trusted test TLS for the fake issuer, without weakening production issuer
validation. Exercise real browser CORS and SDK flows, not an injected
authenticated React context. Fault injection counts token and mutation
requests and tests state/nonce mismatch, token expiry, ambiguous refresh,
receipt lookup, epoch/ETag conflicts, permissions, isolation, reload,
multi-tab logout, and journal-storage failure. Tests need no real Auth0
credentials. Real-provider verification belongs to the initial local release.

The scaffold records these commands, which `tools/check webapp` runs in
`webapp/` for contributors and CI:

```bash
npm ci
npm run check:toolchain
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm audit --audit-level=high
```

`lint` uses ESLint with zero warnings; `format:check` uses Prettier;
`typecheck` checks browser, tests, and tooling without emitting; `test` is
`vitest run`, not watch mode; `build` is `vite build`; and `test:e2e` runs
Playwright with explicit startup/readiness/cleanup for owned processes.
`check:toolchain` verifies Node/npm and Caddy against their pins and validates
the Caddy configuration. Install Playwright's pinned browser binaries and OS
dependencies explicitly in CI/container setup. `npm run dev` starts Vite;
`npm run serve` starts Caddy, not Vite preview.

The authenticated story adds `npm run api:generate` for contributors and
`npm run api:check` to CI before type checking, plus its service/provider test
fixtures. Service-contract changes then run the webapp job. Existing root
Markdown lint/link checks still apply; no Rust checks are replaced.

Commit the lockfile and pin exact direct dependency versions without ranges.
Use `npm ci` for CI and clean installs; never run an implicit update or
`npm audit fix --force`. Set repository-local npm `save-exact`, engine checks,
and `ignore-scripts`. If a pinned native build tool needs an install step,
the scaffold must inspect and allow only that exact package's required step,
document it, and run it explicitly; do not enable all transitive install
scripts. Recheck exceptions on updates and fail clearly if the binary is
missing. No unpinned `npx` download belongs in validation scripts.

Dependabot covers `webapp/` and groups compatible tooling updates for review.
Review lockfile diffs, new transitive packages, licenses, advisories, and
install scripts; run all checks on upgrades. Audit runtime and development
dependencies. High/critical findings block delivery unless a documented,
time-bounded exception explains non-applicability and has an owner; an
unavailable audit is not a passing result. The scaffold records exact package
and Caddy versions when it creates the manifests, rather than adding unused
packages now.

## Consequences

* The application stays a static SPA with one HTTP authority for business
  behavior and no extra application server or shared domain model.
* React's ecosystem and Tailwind's static output provide a documented UI
  foundation, but accessible components and route/session coordination still
  require deliberate implementation.
* Generated types and validators catch contract drift without giving a
  generator control of authentication, retries, or mutation intent.
* The pending-intent journal supports reload recovery but exposes unresolved
  financial payloads to same-origin script and browser session restoration.
  Strict CSP and minimal retention reduce, but do not remove, that risk.
* Caddy adds an executable to local setup in exchange for tested static serving
  and security headers independent of a development server.
* The SDK compatibility gate can delay authenticated delivery. That is
  preferable to silently weakening ADR 0009's refresh safety.

## References

* [React client-only build guidance](https://react.dev/learn/build-a-react-app-from-scratch)
* [React Router declarative mode](https://reactrouter.com/start/declarative/installation)
* [Vite CSP guidance](https://vite.dev/guide/features.html#content-security-policy-csp)
* [Vite deployment and preview limits](https://vite.dev/guide/static-deploy.html)
* [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
* [Tailwind browser compatibility](https://tailwindcss.com/docs/compatibility)
* [Node.js releases](https://nodejs.org/en/about/previous-releases)
* [Node.js published release index](https://nodejs.org/dist/index.json)
* [Caddy static serving](https://caddyserver.com/docs/caddyfile/directives/file_server)
* [Caddy loopback binding](https://caddyserver.com/docs/caddyfile/directives/bind)
* [openapi-typescript](https://openapi-ts.dev/introduction)
* [Ajv standalone validation](https://ajv.js.org/standalone.html)
* [Intl exact string formatting](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/formatToParts)
* [TanStack Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
* [Auth0 SDK configuration](https://auth0.github.io/auth0-spa-js/interfaces/Auth0ClientOptions.html)
* [Auth0 SDK lifecycle methods](https://auth0.github.io/auth0-spa-js/classes/Auth0Client.html)
* [Vitest request mocking](https://vitest.dev/guide/mocking/requests)
* [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)
