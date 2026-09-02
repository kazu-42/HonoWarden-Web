import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  VITE_DEVELOPMENT_STYLE_NONCE,
} from "../src/security/content-security-policy";

describe("content security policy", () => {
  it("keeps production style policy nonce-free and strict", () => {
    const policy = contentSecurityPolicy(false);

    expect(policy).toContain("style-src 'self'");
    expect(policy).not.toContain("nonce-");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it("allows only Vite's nonce-bearing development styles", () => {
    const policy = contentSecurityPolicy(true);

    expect(policy).toContain(
      `style-src 'self' 'nonce-${VITE_DEVELOPMENT_STYLE_NONCE}'`,
    );
    expect(policy).not.toContain("'unsafe-inline'");
  });
});
