# Dependency provenance and release integrity

## Runtime inventory

All runtime code is bundled and served from the Web Vault origin. There are no
CDN imports, external fonts, analytics tags, remote images, or runtime package
downloads.

| Package        | Pinned version | License from installed manifest | Purpose                   | Upstream                          |
| -------------- | -------------: | ------------------------------- | ------------------------- | --------------------------------- |
| `react`        |         19.2.7 | MIT                             | Component and state model | [react.dev](https://react.dev/)   |
| `react-dom`    |         19.2.7 | MIT                             | Browser renderer          | [react.dev](https://react.dev/)   |
| `lucide-react` |         1.25.0 | ISC                             | Original UI control icons | [lucide.dev](https://lucide.dev/) |

Critical build/test tools are pinned exactly in `package.json`:

| Package                   | Version | License from installed manifest | Role                                           |
| ------------------------- | ------: | ------------------------------- | ---------------------------------------------- |
| `vite`                    |   8.1.5 | MIT                             | Client and Worker build                        |
| `@cloudflare/vite-plugin` |  1.45.1 | MIT                             | Cloudflare Worker/Static Assets integration    |
| `wrangler`                | 4.112.0 | MIT OR Apache-2.0               | Local Worker runtime and future deployment CLI |
| `vitest`                  |  4.1.10 | MIT                             | Unit/integration tests                         |
| `@playwright/test`        |  1.61.1 | Apache-2.0                      | Browser and responsive verification            |

The lockfile, not this table, is authoritative for transitive versions and
integrity values.

## Installation controls

- Use pnpm 11.8.0 under Node 22 or newer.
- CI and release builds use `pnpm install --frozen-lockfile`.
- `pnpm-workspace.yaml` applies the local minimum-release-age policy. Explicit
  exceptions are reviewable and version-specific.
- Only pinned `esbuild`, `workerd`, and `sharp` lifecycle scripts are allowed.
  They provide required platform binaries. Any additional package requesting a
  build script fails installation until separately reviewed.
- `pnpm supply-chain:verify` parses the lockfile, verifies direct dependency
  resolution, integrity metadata, build-script allowlist, and disallows remote
  tarball overrides.
- Dependency updates require a focused PR with package/lockfile diff, license
  review, advisory review, tests, build budgets, and independent security review
  for runtime or build-chain changes.

## Artifact controls

`pnpm build` creates a Worker bundle and client asset tree. The build verifier
fails on public source maps, external runtime URLs, service-worker output,
local-preview strings, unexpected inline scripts, checkout-local generated
paths, or budget excess.

Cloudflare's generated `wrangler.json` contains checkout-local `configPath` and
`userConfigPath` metadata. `pnpm build` removes those non-deployable fields from
the actual generated file before verification or hashing. The build gate rejects
any remaining absolute filesystem path, so the release manifest hashes the
exact normalized deployable bytes and remains independent of checkout location.

`pnpm release:manifest` emits a deterministic JSON inventory with relative
path, byte size, and SHA-256 for every deployable file. CI must attest the exact
manifest and artifact against the reviewed commit using GitHub OIDC artifact
attestation. No long-lived signing private key belongs in the repo or developer
environment.

Required release identity chain:

```text
reviewed commit -> frozen lockfile -> green build -> release manifest digest
-> GitHub artifact attestation -> approved Cloudflare deployment version
```

If any link is missing or mismatched, do not deploy. Rebuild from the reviewed
commit; never edit a generated artifact in place.

## Vulnerability and provenance response

Before release, run `pnpm audit:prod`. A critical/high runtime advisory blocks
publication unless an explicit reviewed non-applicability statement identifies
the unreachable code path and compensating controls. Build-only findings are
also evaluated because malicious build execution can alter the runtime bundle.

For a compromised package or artifact:

1. detach or roll back the Web Vault release without changing API/website
   routes;
2. preserve manifest, attestation, lockfile, and redacted logs;
3. identify all releases containing the package/version;
4. rotate user/session credentials only when evidence shows exposure and under a
   separate approved incident plan;
5. replace the dependency, rebuild from a trusted source, review, attest, and
   redeploy.
