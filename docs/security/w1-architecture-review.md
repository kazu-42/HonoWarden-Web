# W1 architecture review

- Linear: HON-177
- Scope: Web Vault foundation before login, cryptography, or item UI
- Date: 2026-09-02
- Result: no unresolved high-risk architecture issue

## Method

This review used the accepted ADR, the repository-grounded threat model, Worker
and session source, architecture/CSP/proxy tests, and the synthetic
authenticated shell. It did not exercise production Cloudflare, real accounts,
or decrypted vault data.

## High-risk questions

| Question                                         | Finding                                                                                          | Status   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------- |
| Can W1 XSS read an unlocked vault?               | No HTML sinks; CSP and Trusted Types deny injection channels. TM-001 remains a W2 rendering gate | Resolved |
| Can the proxy attach ambient credentials?        | Cookies are dropped; unsafe methods need exact Origin and Fetch Metadata                         | Resolved |
| Can tokens or plaintext leave the browser realm? | Memory-only session; UI snapshots omit secrets; Worker logs are field-allowlisted                | Resolved |
| Can W1 send vault plaintext to a server or SDK?  | No telemetry SDK; authenticated shell makes no mutating or third-party request                   | Resolved |
| Can a dependency or CDN replace the origin?      | Frozen lockfile, three-package build allowlist, no remote runtime assets                         | Resolved |
| Can rollback take down the API or website?       | Separate repository and hostname; no routes or deploy script in the local scaffold               | Resolved |

## Residual risks that are not W1 architecture defects

- **TM-001:** decrypted field rendering does not exist yet. HON-178 must keep
  `trusted-types 'none'` and treat every decrypted string as hostile display
  data.
- **TM-003:** GitHub artifact attestation is not load-bearing until CI runs on
  the published repository. Publication still requires SHA-pinned Actions and a
  frozen lockfile.
- **TM-007:** a malicious extension or compromised OS can read in-memory
  secrets. Origin policy cannot close that class.

The W1 source boundary has no blocking architecture defect. Feature UI must not
start until this review stays green on the reviewed commit.

## Evidence

- ADR 0001 includes threat model, data-flow, original-design rules, budgets,
  test strategy, observability, migration, and rollback.
- `MemorySessionStore` exposes only `status`, `accountLabel`, and `expiresAt`.
- Worker origin policy, header allowlist, config rewrite, and log allowlist are
  covered by Vitest.
- Playwright locked and authenticated shells assert CSP, axe, no persistence,
  no third-party requests, and no vault plaintext payloads.
