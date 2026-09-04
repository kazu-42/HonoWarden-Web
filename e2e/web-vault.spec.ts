import { mkdir } from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const evidenceRoot = path.resolve(
  ".workflow/hon-177-web-vault-foundation/results/screenshots",
);

test.beforeAll(async () => {
  await mkdir(evidenceRoot, { recursive: true });
});

test("locked boundary enforces browser policy without persistence", async ({
  page,
}, testInfo) => {
  const monitor = await monitorPage(page);
  const response = await page.goto("/", { waitUntil: "networkidle" });

  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("trusted-types 'none'");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("nonce-");

  await expect(
    page.getByRole("heading", { name: "HonoWarden Web Vault" }),
  ).toBeVisible();
  await expect(page.getByText("Locked")).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);

  await monitor.assertClean();
  await assertNoPersistentState(page);
  await assertNoHorizontalOverflow(page);
  await assertAccessibility(page);
  await saveScreenshot(page, testInfo, "locked");
});

test("authenticated shell is responsive, keyboard-operable, and locks cleanly", async ({
  page,
}, testInfo) => {
  const monitor = await monitorPage(page);
  await page.goto("/_local/authenticated-shell", { waitUntil: "networkidle" });

  await expect(page.getByRole("navigation", { name: "Vault" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Vault", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("synthetic@example.test")).toBeVisible();

  await page.getByRole("button", { name: "Favorites" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Favorites", exact: true }),
  ).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search vault" });
  await search.fill("not present");
  await expect(
    page.getByRole("heading", { name: "No matching items" }),
  ).toBeVisible();
  await search.fill("");

  await page.getByRole("button", { name: "Trash" }).click();
  await expect(
    page.getByRole("heading", { name: "Trash", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trash is empty" }),
  ).toBeVisible();

  await monitor.assertClean();
  await assertNoPersistentState(page);
  await assertNoHorizontalOverflow(page);
  await assertAccessibility(page);
  await saveScreenshot(page, testInfo, "authenticated");

  await monitor.clearCspViolations();
  const lockButton = page.getByRole("button", { name: "Lock vault" });
  const lockTarget = await lockButton.boundingBox();
  const minimumTarget = testInfo.project.name.startsWith("mobile") ? 44 : 38;
  expect(lockTarget?.width).toBeGreaterThanOrEqual(minimumTarget);
  expect(lockTarget?.height).toBeGreaterThanOrEqual(minimumTarget);
  await lockButton.click();
  await expect(
    page.getByRole("heading", { name: "HonoWarden Web Vault" }),
  ).toBeVisible();
  await expect(page.getByText("synthetic@example.test")).toHaveCount(0);
  await assertNoPersistentState(page);
  await monitor.assertClean();
});

async function assertAccessibility(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact ?? ""),
  );
  expect(blocking).toEqual([]);
}

async function assertNoPersistentState(page: Page): Promise<void> {
  const state = await page.evaluate(async () => ({
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    indexedDatabases:
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).length
        : 0,
    cacheEntries: "caches" in globalThis ? (await caches.keys()).length : 0,
    serviceWorkers:
      "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).length
        : 0,
  }));

  expect(state).toEqual({
    localStorage: 0,
    sessionStorage: 0,
    indexedDatabases: 0,
    cacheEntries: 0,
    serviceWorkers: 0,
  });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

async function monitorPage(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  const mutatingRequests: string[] = [];
  const sensitivePayloads: string[] = [];

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const target = globalThis as typeof globalThis & {
      __cspViolations?: string[];
    };
    target.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      target.__cspViolations?.push(
        `${event.violatedDirective}:${event.blockedURI}`,
      );
    });
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`page: ${error.name}: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== "http://127.0.0.1:4175") {
      externalRequests.push(request.url());
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      mutatingRequests.push(`${request.method()} ${request.url()}`);
    }
    const payload = `${request.postData() ?? ""} ${request.url()}`;
    if (
      /masterPassword|plaintext|otpauth|password=/.test(payload) ||
      requestUrl.searchParams.has("note")
    ) {
      sensitivePayloads.push(request.url());
    }
  });

  return {
    async clearCspViolations(): Promise<void> {
      await page.evaluate(() => {
        const target = globalThis as typeof globalThis & {
          __cspViolations?: string[];
        };
        target.__cspViolations = [];
      });
    },
    async assertClean(): Promise<void> {
      const violations = await page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __cspViolations?: string[];
            }
          ).__cspViolations ?? [],
      );
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
      expect(externalRequests).toEqual([]);
      expect(mutatingRequests).toEqual([]);
      expect(sensitivePayloads).toEqual([]);
    },
  };
}

async function saveScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.screenshot({
    path: path.join(evidenceRoot, `${name}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
