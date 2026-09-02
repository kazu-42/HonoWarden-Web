import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("release and workflow tooling", () => {
  it("isolates synthetic e2e artifacts from production dist", async () => {
    const [viteConfig, playwrightConfig, gitignore] = await Promise.all([
      readFile(path.join(root, "vite.config.ts"), "utf8"),
      readFile(path.join(root, "playwright.config.ts"), "utf8"),
      readFile(path.join(root, ".gitignore"), "utf8"),
    ]);

    expect(viteConfig).toContain('mode === "e2e"');
    expect(viteConfig).toContain('"dist-e2e"');
    expect(playwrightConfig).toContain("vite preview --mode e2e");
    expect(gitignore.split("\n")).toContain("dist-e2e/");
  });

  it("removes checkout-local metadata from deployable Wrangler config", () => {
    const fixtures = ["first-checkout", "second-checkout"].map((name) =>
      mkdtempSync(path.join(tmpdir(), `honowarden-web-${name}-`)),
    );

    try {
      const normalized = fixtures.map((fixture, index) => {
        const workerRoot = path.join(fixture, "honowarden_web");
        mkdirSync(workerRoot, { recursive: true });
        writeFileSync(
          path.join(workerRoot, "wrangler.json"),
          `${JSON.stringify({
            configPath: `/checkout/${index}/wrangler.jsonc`,
            userConfigPath: `/checkout/${index}/wrangler.jsonc`,
            name: "honowarden-web",
            main: "index.js",
          })}\n`,
        );

        const result = spawnSync(
          process.execPath,
          [path.join(root, "scripts/normalize-build.mjs"), "--root", fixture],
          { encoding: "utf8" },
        );
        expect(result.status).toBe(0);
        return readFileSync(path.join(workerRoot, "wrangler.json"), "utf8");
      });

      expect(normalized[0]).toBe(normalized[1]);
      expect(normalized[0]).not.toContain("configPath");
      expect(normalized[0]).not.toContain("/checkout/");
    } finally {
      for (const fixture of fixtures) {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  it("configures Vite's development style nonce without weakening production", async () => {
    const viteConfig = await readFile(
      path.join(root, "vite.config.ts"),
      "utf8",
    );

    expect(viteConfig).toContain("cspNonce");
    expect(viteConfig).toContain('command === "serve"');
    expect(viteConfig).not.toContain("unsafe-inline");
  });

  it("prepares the ignored readback directory before Linear mutations", async () => {
    const source = await readFile(
      path.join(
        root,
        ".workflow/hon-177-web-vault-foundation/scripts/sync-linear-checkpoint.mjs",
      ),
      "utf8",
    );
    const preparation = source.indexOf(
      "await mkdir(path.dirname(outputPath), { recursive: true })",
    );
    const firstLinearRead = source.indexOf("const before = await readIssues()");

    expect(preparation).toBeGreaterThan(-1);
    expect(preparation).toBeLessThan(firstLinearRead);
  });

  it("paginates every Linear comment before checkpoint creation", async () => {
    const source = await readFile(
      path.join(
        root,
        ".workflow/hon-177-web-vault-foundation/scripts/sync-linear-checkpoint.mjs",
      ),
      "utf8",
    );

    expect(source).toContain("comments(first: 100, after: $after)");
    expect(source).toContain("pageInfo { hasNextPage endCursor }");
    expect(source).toContain("seenCursors");
  });

  it("pins CI actions by commit SHA and never deploys", async () => {
    const workflow = await readFile(
      path.join(root, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/^name: CI$/m);
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("pnpm verify");
    expect(workflow).toContain("pnpm test:e2e");
    expect(workflow).not.toMatch(/\bwrangler\s+deploy\b/);
    expect(workflow).not.toMatch(/uses:\s+[\w-]+\/[\w-]+@v\d/);

    const pinnedActions = [
      ...workflow.matchAll(/uses:\s+([^\s]+@[0-9a-f]{40})/g),
    ].flatMap((match) => (match[1] ? [match[1]] : []));
    expect(pinnedActions.length).toBeGreaterThanOrEqual(2);
    expect(
      pinnedActions.some((action) => action.startsWith("actions/checkout@")),
    ).toBe(true);
    expect(
      pinnedActions.some((action) => action.startsWith("actions/setup-node@")),
    ).toBe(true);
  });

  it("fails the supply-chain gate when minimumReleaseAge is missing", () => {
    const fixture = mkdtempSync(
      path.join(tmpdir(), "honowarden-web-lock-policy-"),
    );

    try {
      writeFileSync(path.join(fixture, "package.json"), "{}\n");
      writeFileSync(
        path.join(fixture, "pnpm-workspace.yaml"),
        [
          "packages: []",
          "allowBuilds:",
          "  esbuild: true",
          "  sharp: true",
          "  workerd: true",
          "minimumReleaseAgeStrict: true",
          "minimumReleaseAgeExclude: []",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(fixture, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .: {}",
          "packages: {}",
          "snapshots: {}",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        process.execPath,
        [path.join(root, "scripts/verify-lockfile.mjs")],
        { cwd: fixture, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("minimum release age");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
