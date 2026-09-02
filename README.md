# HonoWarden Web Vault

HonoWarden Web Vault is the original browser client for HonoWarden. This
repository owns only the browser shell and its same-origin edge proxy. It does
not own the HonoWarden API Worker or the public project website.

## Status

HON-177 W1 is the source candidate for the browser security and deployment
boundary. The current application proves CSP, origin policy, session isolation,
accessibility, and rollback before login, cryptography, sync, or vault item
workflows are added under HON-178.

Source publication happens through pull requests against this repository. There
is no Cloudflare deployment, custom domain, real account, or production
activation associated with W1.

## Runtime shape

- React renders a client-only locked or authenticated shell.
- Cloudflare Worker Static Assets serves the built application.
- The Worker handles all requests so static responses receive the same strict
  security headers.
- Browser API requests use same-origin `/api/*` and `/identity/*` paths.
- A successful `/api/config` response is schema-checked and its `vault`, `api`,
  and `identity` URLs are normalized to the Web Vault origin before the browser
  receives it.
- Production proxying requires a Cloudflare service binding to the existing API
  Worker. Public-origin fetch requires the exact `public-preview` transport,
  with `local` paired only to loopback and `preview` paired only to a
  `*.workers.dev` host. The checked-in local config disables both public Worker
  and version preview URLs.
- Access and refresh tokens are held only by `MemorySessionStore`; its UI
  snapshot contains no token values.

The proposed production origin is `app.honowarden.com`. Existing
`vault.honowarden.com`, `honowarden.com`, and `www.honowarden.com` routes are
explicitly outside this repository's deployment ownership.

## Local development

Prerequisites are Node 22 or newer, pnpm 11, and direnv.

```sh
direnv allow
pnpm install --frozen-lockfile
pnpm dev
```

The root route renders the locked boundary. The authenticated shell can be
inspected only on a localhost development build at
`/_local/authenticated-shell`; Vite removes that branch from production output.
It uses synthetic in-memory material and makes no API request.

Vite development CSS receives a fixed local-only nonce through
`html.cspNonce`; the Worker permits that nonce only while `import.meta.env.DEV`
is true. Production and e2e builds retain `style-src 'self'` with no nonce or
inline-style allowance.

## Verification

```sh
pnpm test
pnpm check
pnpm lint
pnpm format
pnpm build
pnpm build:verify
pnpm supply-chain:verify
pnpm release:manifest
pnpm test:e2e
```

No `deploy` script exists. Publication, repository creation, Cloudflare
deployment, service-binding activation, and custom-domain changes are separate
approval gates described in [docs/deployment.md](docs/deployment.md).

## Security invariants

- No token, key, credential, plaintext vault field, or identity enters a URL,
  cookie, browser storage, Cache API, HTML response, log, or telemetry event.
- No external runtime script, stylesheet, font, image, analytics, or CDN origin
  is allowed.
- No service worker or server-side rendering exists in W1.
- Unsafe proxy methods require an exact same-origin `Origin` and compatible
  Fetch Metadata signal.
- Only explicit API protocol request headers cross the proxy boundary. Cookies,
  edge identity/visitor metadata, forwarding headers, and unknown headers do
  not; upstream cookies and CORS headers are also removed.
- HTML and API responses are `no-store`; only fingerprinted static assets are
  immutable.
- Invalid origin configuration, a missing service binding outside the explicitly
  paired local/preview transport, an invalid or oversized upstream config,
  static asset failure, and upstream failure fail visibly. Missing, misspelled,
  or crossed environment/host values and custom domains never enable public
  fallback.

The accepted architecture is in
[ADR 0001](docs/adr/0001-web-vault-foundation.md), and the repository-grounded
threat model is in
[HonoWarden-Web-threat-model.md](docs/security/HonoWarden-Web-threat-model.md).
