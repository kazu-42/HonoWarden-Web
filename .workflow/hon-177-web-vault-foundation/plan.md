# HON-177 Web Vault Foundation

## Objective

Create an original HonoWarden browser application foundation that proves the
browser security and deployment boundaries before password login, vault
cryptography, or item workflows begin.

## Current topology

- `honowarden.com` and `www.honowarden.com` are the independently deployed
  public website.
- `vault.honowarden.com` is the existing API Worker and must remain stable for
  official clients.
- `app.honowarden.com` is currently unassigned and is the proposed Web Vault
  origin. Its DNS, custom-domain route, and production activation are separate
  approval-gated operations.
- Source ownership is a new repository named `HonoWarden-Web`. It has no
  deployment authority over the API or website repositories.

## Decisions to prove in source

1. React and Vite render a client-only application; Cloudflare Worker Static
   Assets serves it without server-side rendering decrypted state.
2. Browser calls use same-origin `/api/*` and `/identity/*`. The Web Vault
   Worker validates browser origin and proxies only those prefixes to the API
   Worker through a service binding by default. Public fetch is an explicit
   transport pairing: `local` works only on loopback and `preview` only on
   `*.workers.dev`. It cannot activate on a custom domain or from missing,
   misspelled, or crossed environment/host values. The checked-in config exposes
   no public Worker or version preview URL.
3. Access and refresh tokens exist only in a bounded in-memory session object.
   They never enter URL parameters, cookies, Web Storage, IndexedDB, Cache API,
   HTML, logs, analytics, or server-rendered output.
4. Static responses use a deny-by-default CSP, Trusted Types enforcement,
   cross-origin isolation headers, no framing, and no external asset origins.
5. There is no service worker in W1. Fingerprinted static assets are immutable;
   HTML and all proxied API responses are `no-store`.
6. The dependency lockfile and a generated release manifest are the source of
   asset provenance. No CDN script, font, image, or runtime dependency is
   allowed. Production releases will require reviewed CI, a commit SHA, an
   artifact digest, and GitHub artifact attestation before deployment.

## Test sequence

1. Red: Worker tests require strict CSP, Trusted Types, cache behavior,
   same-origin mutation checks, service-binding proxying, header stripping,
   and fail-closed origin validation.
2. Red: session tests require memory-only secrets, non-secret UI snapshots,
   expiry, lock, and invalid-input behavior.
3. Red: component tests require distinct locked and authenticated shells.
4. Green: implement the narrow Worker, session primitive, and original shell.
5. Add build, lint, type, dependency provenance, accessibility, responsive
   Playwright, CSP console, and external-request assertions.
6. Run an independent security/source review and resolve every high-risk issue
   before marking the issue source-ready.

## Safety and rollback

- No D1 or R2 migration is needed for W1.
- No production hostname, route, service binding, secret, user, or vault data is
  created during local implementation.
- A Web Vault rollback removes or reverts only the `app.honowarden.com` Worker
  release. It cannot replace or mutate the API or public website routes.
- Invalid API origin, cross-origin state change, missing static binding, or
  upstream failure returns a visible error. The Worker does not silently fall
  back to a different origin or cached vault state.
- Logs contain request id, method, normalized path class, status, duration, and
  deployment environment only. They exclude URL query, headers, bodies,
  identities, tokens, keys, and decrypted or encrypted vault payloads.

## External gates

GitHub repository creation, commit, push, PR, review comments, merge,
Cloudflare deploy, DNS/custom-domain changes, service-binding activation, and
production smoke remain explicit external publication or production gates.
