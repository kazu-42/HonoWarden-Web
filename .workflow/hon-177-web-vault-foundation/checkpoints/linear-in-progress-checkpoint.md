<!-- honowarden-managed:HON-177:implementation-checkpoint -->

## HON-177 implementation checkpoint

Implementation started in the new isolated local repository
`/Users/hackhike/dev/HonoWarden-Web` from an empty `main` branch. The repository
has no remote and no deployment credentials or authority.

Live topology readback established the non-overlap invariant:

- `honowarden.com` and `www.honowarden.com` remain the public website;
- `vault.honowarden.com` remains the existing HonoWarden API Worker used by
  official clients;
- `app.honowarden.com` is currently unassigned and is the proposed independent
  Web Vault origin.

Accepted W1 boundary:

- React 19 and Vite 8 client-only shell on Cloudflare Worker Static Assets;
- same-origin browser requests to `/api/*` and `/identity/*`, with strict
  origin validation and an API service-binding proxy;
- access and refresh tokens held only in a bounded memory session object;
- deny-by-default CSP, Trusted Types enforcement, no external runtime assets,
  no service worker, no SSR, and no browser persistence of secret material;
- immutable fingerprinted assets, while HTML and API responses remain
  `no-store`;
- no D1 or R2 migration in W1 and independent rollback from both API and public
  website routes.

TDD red evidence: three test files fail only because the Worker, memory-session,
and React shell modules do not exist yet. The tests already specify strict
headers and cache policy, service-binding proxying, ambient identity stripping,
cross-origin mutation rejection, invalid-origin fail-closed behavior, session
expiry/lock, and locked/authenticated UI boundaries.

No GitHub repository creation, commit, push, PR, comment, merge, Cloudflare
deploy, DNS/custom-domain change, service-binding activation, secret mutation,
real user or vault data operation, browser automation, or production action is
part of this checkpoint. Those remain separate publication and production
gates.

Next evidence gate: green focused tests, source and security documentation,
full type/lint/format/build gates, Playwright desktop/mobile and CSP/network
verification, independent high-risk review, and exact Linear source-ready
readback.
