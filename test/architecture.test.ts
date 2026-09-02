import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Web Vault architecture boundaries", () => {
  it("contains no browser persistence, dynamic DOM injection, or service worker surface", async () => {
    const source = await readSourceTree(path.join(root, "src"));
    const forbidden = [
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bindexedDB\b/,
      /\bcaches\s*\./,
      /serviceWorker/,
      /dangerouslySetInnerHTML/,
      /\.innerHTML\s*=/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /document\.cookie/,
    ];

    for (const pattern of forbidden) {
      expect(source, `forbidden source pattern: ${pattern}`).not.toMatch(
        pattern,
      );
    }
  });

  it("loads scripts and styles only from local source paths without inline script", async () => {
    const html = await readFile(path.join(root, "index.html"), "utf8");
    const document = new JSDOM(html).window.document;

    const scripts = [...document.querySelectorAll("script")];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("src")).toBe("/src/main.tsx");
    expect(scripts[0]?.textContent?.trim()).toBe("");

    for (const element of document.querySelectorAll("[src], [href]")) {
      const value = element.getAttribute("src") ?? element.getAttribute("href");
      expect(value).not.toMatch(/^https?:\/\//);
      expect(value).not.toMatch(/^\/\//);
    }
  });

  it("keeps production routes and deployment mutations out of the local scaffold", async () => {
    const wrangler = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(wrangler).toContain('"run_worker_first": true');
    expect(wrangler).toContain('"workers_dev": false');
    expect(wrangler).toContain('"preview_urls": false');
    expect(wrangler).not.toContain('"routes"');
    expect(wrangler).not.toContain('"custom_domain"');
    expect(Object.keys(packageJson.scripts)).not.toContain("deploy");
  });

  it("records the complete W1 architecture and security decisions", async () => {
    const adr = await readFile(
      path.join(root, "docs/adr/0001-web-vault-foundation.md"),
      "utf8",
    );
    const threatModel = await readFile(
      path.join(root, "docs/security/HonoWarden-Web-threat-model.md"),
      "utf8",
    );

    for (const requirement of [
      "## Threat model",
      "## Data flow",
      "Repository and runtime ownership",
      "API and origin boundary",
      "Token and session storage",
      "CSP and Trusted Types",
      "CSRF and XSS model",
      "Service worker and cache policy",
      "Dependency provenance and release signing",
      "Original design rules",
      "Accessibility and performance budgets",
      "Test strategy",
      "Observability",
      "Migration and rollback",
    ]) {
      expect(adr).toContain(requirement);
    }
    expect(adr).toContain("TM-001");
    expect(adr).toContain("docs/security/HonoWarden-Web-threat-model.md");
    for (const section of [
      "## Executive summary",
      "## Scope and assumptions",
      "## System model",
      "## Assets and security objectives",
      "## Attacker model",
      "## Entry points and attack surfaces",
      "## Top abuse paths",
      "## Threat model table",
      "## Criticality calibration",
      "## Focus paths for security review",
    ]) {
      expect(threatModel).toContain(section);
    }
    expect(threatModel).toContain("TM-001");
    expect(threatModel).toContain("src/worker.ts");
    expect(threatModel).toContain("src/session/memory-session-store.ts");
  });

  it("records a W1 architecture review with no unresolved high-risk issue", async () => {
    const review = await readFile(
      path.join(root, "docs/security/w1-architecture-review.md"),
      "utf8",
    );

    expect(review).toContain("HON-177");
    expect(review).toContain("no unresolved high-risk architecture issue");
    expect(review).toContain("TM-001");
    expect(review).toContain("TM-003");
    expect(review).not.toMatch(
      /unresolved high-risk architecture issue remains/i,
    );
    expect(review).not.toMatch(/\bcritical finding\b/i);
  });

  it("keeps runtime source free of telemetry SDKs, vault plaintext sinks, and upstream trade dress", async () => {
    const source = await readSourceTree(path.join(root, "src"));
    const packageJson = await readFile(path.join(root, "package.json"), "utf8");
    const html = await readFile(path.join(root, "index.html"), "utf8");
    const inventory = [source, packageJson, html].join("\n");
    const forbidden = [
      /\bsentry\b/i,
      /\bposthog\b/i,
      /\bmixpanel\b/i,
      /\bamplitude\b/i,
      /\bgoogletagmanager\b/i,
      /\bgtag\s*\(/i,
      /\bfullstory\b/i,
      /\bdatadog\b/i,
      /\bnewrelic\b/i,
      /\banalytics\.google\b/i,
      /\bsendBeacon\s*\(/,
      /\bmasterPassword\b/,
      /\bdecryptedVault\b/,
      /\bbitwarden\.com\/(?:images|icons)\b/i,
      /\bvaultwarden\b/i,
    ];

    for (const pattern of forbidden) {
      expect(inventory, `forbidden runtime pattern: ${pattern}`).not.toMatch(
        pattern,
      );
    }
  });
});

async function readSourceTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      parts.push(await readSourceTree(absolute));
    } else if (/\.(?:ts|tsx|css)$/.test(entry.name)) {
      parts.push(await readFile(absolute, "utf8"));
    }
  }
  return parts.join("\n");
}
