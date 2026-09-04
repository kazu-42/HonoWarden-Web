# Web Vault deployment and rollback

## Current state

The GitHub repository exists for source review. No Cloudflare Worker, service
binding, DNS record, custom domain, deployment secret, production release, or
real-user smoke was created for HON-177.

The live topology that must be preserved is:

| Host                   | Current owner                  | Web Vault authority    |
| ---------------------- | ------------------------------ | ---------------------- |
| `honowarden.com`       | Public website Worker          | None                   |
| `www.honowarden.com`   | Public website Worker          | None                   |
| `vault.honowarden.com` | HonoWarden API Worker          | Proxy target only      |
| `app.honowarden.com`   | Unassigned at W1 planning time | Proposed custom domain |

## Required production configuration

Production activation must add a separate Wrangler environment or generated
deployment overlay with:

- deployment environment `production`;
- `HONOWARDEN_API_ORIGIN=https://vault.honowarden.com`;
- `HONOWARDEN_API_TRANSPORT=service-binding`;
- `HONOWARDEN_API` service binding to the exact production API Worker service;
- custom domain `app.honowarden.com` only;
- Worker Observability configured with reviewed fields and retention;
- a least-privilege deploy token unable to alter D1, R2, email, account roles,
  `vault.honowarden.com`, or website routes.

Do not put the production route into the default local `wrangler.jsonc`. This
keeps `pnpm dev`, type generation, and accidental deploy commands incapable of
claiming a public URL: both `workers_dev` and `preview_urls` are false. The repo
intentionally has no `deploy` package script. The checked-in `public-preview`
transport works only for `local` on a loopback host. An approved preview overlay
must enable its workers.dev/preview URL and set the environment to `preview`;
`preview` on loopback and `local` on workers.dev both fail closed. A custom
domain, omitted variable, or misspelled environment still requires
`HONOWARDEN_API` and returns `503` when it is absent.

## Approval gates

Before the first production action, require explicit approval for:

1. source publication through a reviewed pull request;
2. CI workflow permissions and artifact attestation;
3. Cloudflare preview Worker creation;
4. production service binding and custom domain;
5. real-user or real-vault smoke testing.

GitHub publication does not imply production approval. A green preview does not
authorize a custom-domain change.

## Preflight evidence

Run locally from a clean reviewed commit:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm lint
pnpm format
pnpm supply-chain:verify
pnpm build
pnpm build:verify
pnpm release:manifest
pnpm test:e2e
pnpm audit:prod
```

Required artifacts:

- commit SHA and clean-tree readback;
- lockfile SHA-256 and direct/transitive package count;
- test/check/lint/format output;
- desktop/mobile screenshots and axe/network/CSP results;
- bundle gzip sizes against ADR budgets;
- deterministic release manifest and SHA-256;
- independent review with no unresolved critical/high finding;
- GitHub CI check and artifact-attestation URLs after publication.

## Staged activation

Only after the corresponding approvals:

1. Create the named GitHub repository without changing this local history.
2. Push a reviewed branch, open a PR, require CI and human review, and merge.
3. Build from the merged commit with a frozen lockfile and attest the release
   manifest.
4. Create a reviewed preview overlay that enables only its workers.dev and
   version preview URLs, sets environment `preview`, and keeps transport
   `public-preview`. Deploy it unbound, then verify headers, locked shell,
   synthetic authenticated shell, API proxy errors, and no external requests.
   Public fallback must fail on loopback and every custom-domain host in this
   environment.
5. Configure the production API service binding. Verify a synthetic
   unauthenticated `/api/config` read through the preview. Assert that `vault`,
   `api`, and `identity` use the preview origin, `notifications` remains the
   reviewed upstream value, and no body, query, header, or identity is logged.
6. Snapshot all Worker custom domains and DNS records for the zone. Assert the
   API and website routes have their expected owners.
7. Attach only `app.honowarden.com` to the attested Web Vault Worker.
8. Verify all four hostnames independently. API and website response shapes
   must remain unchanged.
9. Run locked-shell and synthetic-account smoke. W1 must not use real vault
   plaintext because authentication/data workflows belong to HON-178.
10. Record deployment version, manifest hash, route readback, smoke evidence,
    rollback version, and Linear checkpoint.

## Health and failure policy

The app is healthy only when:

- HTML has strict CSP, Trusted Types, cross-origin isolation, and `no-store`;
- a fingerprinted static asset is immutable;
- no external runtime request occurs;
- production API paths use the service binding;
- `/api/config` exposes only same-origin browser API and identity URLs and rejects
  malformed, oversized, or origin-changing success responses;
- public API fallback works only for `local` on loopback or `preview` on a
  `*.workers.dev` host;
- invalid origin, missing binding, static failure, and upstream failure produce
  explicit `4xx/5xx` with a request id;
- `vault.honowarden.com`, `honowarden.com`, and `www.honowarden.com` retain their
  independent expected responses.

Do not hide an upstream or binding outage by serving stale API data, another API
origin, a cached authenticated shell, or a success-shaped response.

## Rollback

Preferred rollback is Cloudflare Worker version rollback to the prior attested
Web Vault release. If the new Worker cannot safely serve, detach only
`app.honowarden.com` while preserving the preview URL for investigation.

After rollback:

1. verify API and both website hostnames were untouched;
2. verify the app either serves the previous version or fails closed;
3. preserve redacted Worker logs, release manifest, route snapshots, and request
   ids;
4. do not revert API migrations, rotate credentials, delete D1/R2 data, purge
   unrelated caches, or alter email routing;
5. fix forward in a new reviewed and attested release.

Because W1 has no database or durable browser migration, route/version rollback
is sufficient. Future offline storage or schema changes require a new migration
and rollback section before implementation.
