import { describe, expect, it, vi } from "vitest";

import { handleRequest, type WebVaultEnv } from "../src/worker";

function fetcher(
  implementation: (request: Request) => Response | Promise<Response>,
): Fetcher {
  return { fetch: vi.fn(implementation) } as unknown as Fetcher;
}

function environment(overrides: Partial<WebVaultEnv> = {}): WebVaultEnv {
  return {
    ASSETS: fetcher(
      async () =>
        new Response('<!doctype html><div id="root"></div>', {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    ),
    HONOWARDEN_API_ORIGIN: "https://vault.honowarden.com",
    HONOWARDEN_DEPLOYMENT_ENV: "test",
    ...overrides,
  };
}

describe("Web Vault Worker boundary", () => {
  it("adds a strict browser security policy and no-store to HTML", async () => {
    const response = await handleRequest(
      new Request("https://app.honowarden.com/"),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("cross-origin-embedder-policy")).toBe(
      "require-corp",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");

    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("trusted-types 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("https:");
  });

  it("uses immutable caching only for fingerprinted static assets", async () => {
    const assets = fetcher(
      async () =>
        new Response("body {}", {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        }),
    );

    const response = await handleRequest(
      new Request("https://app.honowarden.com/assets/app-A1b2c3d4.css"),
      environment({ ASSETS: assets }),
    );

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("never caches HTML fallbacks or failed fingerprinted asset responses", async () => {
    const cases = [
      new Response('<!doctype html><div id="root"></div>', {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      new Response("missing", {
        status: 404,
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      }),
    ];

    for (const assetResponse of cases) {
      const response = await handleRequest(
        new Request("https://app.honowarden.com/assets/app-A1b2c3d4.js"),
        environment({ ASSETS: fetcher(async () => assetResponse.clone()) }),
      );

      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("proxies API requests through the service binding without forwarding ambient identity", async () => {
    const api = fetcher(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "session=must-not-reach-browser",
          },
        }),
    );
    const request = new Request(
      "https://app.honowarden.com/api/sync?continuation=opaque",
      {
        headers: {
          Authorization: "Bearer synthetic-token",
          "Bitwarden-Client-Name": "web-vault",
          "CF-Access-Authenticated-User-Email": "ambient@example.test",
          "CF-Connecting-IP": "198.51.100.77",
          "CF-IPCountry": "JP",
          Connection: "keep-alive",
          Cookie: "ambient=browser-cookie",
          "Device-Type": "10",
          Origin: "https://app.honowarden.com",
          "Proxy-Authorization": "Basic synthetic-proxy-credential",
          Referer: "https://app.honowarden.com/private-view",
          "X-Correlation-Id": "ambient-correlation",
          "X-Forwarded-For": "203.0.113.8",
          "X-Request-Email": "explicit-login-protocol-value",
        },
      },
    );

    const response = await handleRequest(
      request,
      environment({ HONOWARDEN_API: api }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const proxied = vi.mocked(api.fetch).mock.calls[0]?.[0];
    expect(proxied).toBeInstanceOf(Request);
    expect((proxied as Request).url).toBe(
      "https://vault.honowarden.com/api/sync?continuation=opaque",
    );
    expect((proxied as Request).headers.get("authorization")).toBe(
      "Bearer synthetic-token",
    );
    expect((proxied as Request).headers.get("bitwarden-client-name")).toBe(
      "web-vault",
    );
    expect((proxied as Request).headers.get("device-type")).toBe("10");
    expect((proxied as Request).headers.get("x-request-email")).toBe(
      "explicit-login-protocol-value",
    );
    expect(
      (proxied as Request).headers.get("cf-access-authenticated-user-email"),
    ).toBeNull();
    expect((proxied as Request).headers.get("cf-connecting-ip")).toBeNull();
    expect((proxied as Request).headers.get("cf-ipcountry")).toBeNull();
    expect((proxied as Request).headers.get("cookie")).toBeNull();
    expect((proxied as Request).headers.get("connection")).toBeNull();
    expect((proxied as Request).headers.get("proxy-authorization")).toBeNull();
    expect((proxied as Request).headers.get("referer")).toBeNull();
    expect((proxied as Request).headers.get("x-correlation-id")).toBeNull();
    expect((proxied as Request).headers.get("x-forwarded-for")).toBeNull();
    expect((proxied as Request).headers.get("origin")).toBe(
      "https://vault.honowarden.com",
    );
  });

  it("keeps config-driven browser API URLs on the Web Vault origin", async () => {
    const upstreamConfig = {
      version: "2026.7.0",
      gitHash: "honowarden",
      server: null,
      environment: {
        cloudRegion: "self-hosted",
        vault: "https://vault.honowarden.com",
        api: "https://vault.honowarden.com/api",
        identity: "https://vault.honowarden.com/identity",
        notifications: "https://vault.honowarden.com/notifications",
        icons: "",
        sso: "",
      },
      object: "config",
    };
    const api = fetcher(
      async () =>
        new Response(JSON.stringify(upstreamConfig), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ETag: '"upstream-config"',
          },
        }),
    );

    const response = await handleRequest(
      new Request("https://app.honowarden.com/api/config"),
      environment({ HONOWARDEN_API: api }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      environment: {
        vault: "https://app.honowarden.com",
        api: "https://app.honowarden.com/api",
        identity: "https://app.honowarden.com/identity",
        notifications: "https://vault.honowarden.com/notifications",
      },
      object: "config",
      version: "2026.7.0",
    });
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when an upstream config attempts to change the API boundary", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const api = fetcher(async () =>
      Response.json({
        object: "config",
        environment: {
          vault: "https://vault.honowarden.com",
          api: "https://attacker.example/api",
          identity: "https://vault.honowarden.com/identity",
          notifications: "https://vault.honowarden.com/notifications",
        },
      }),
    );

    try {
      const response = await handleRequest(
        new Request("https://app.honowarden.com/api/config"),
        environment({
          HONOWARDEN_API: api,
          HONOWARDEN_DEPLOYMENT_ENV: "production",
        }),
      );

      expect(response.status).toBe(502);
      const body = (await response.json()) as { requestId: string };
      const logged = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        error: "api_upstream_invalid_response",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(response.headers.get("x-request-id")).toBe(body.requestId);
      expect(logged).toMatchObject({
        event: "api_proxy_invalid_config",
        requestId: body.requestId,
        pathClass: "api",
        status: 502,
        environment: "production",
      });
      expect(JSON.stringify({ body, logged })).not.toContain(
        "attacker.example",
      );
    } finally {
      error.mockRestore();
    }
  });

  it("rewrites only query-free same-API redirects and drops unsafe redirect policy", async () => {
    const safeApi = fetcher(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://vault.honowarden.com/account" },
        }),
    );
    const unsafeApi = fetcher(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            "Content-Security-Policy-Report-Only":
              "default-src 'self'; report-uri https://attacker.example/report",
            Location:
              "https://vault.honowarden.com/account?token=must-not-enter-url#secret",
            NEL: '{"report_to":"attacker"}',
            "Report-To":
              '{"group":"attacker","endpoints":[{"url":"https://attacker.example"}]}',
          },
        }),
    );

    const safe = await handleRequest(
      new Request("https://app.honowarden.com/identity/redirect"),
      environment({ HONOWARDEN_API: safeApi }),
    );
    const unsafe = await handleRequest(
      new Request("https://app.honowarden.com/identity/redirect"),
      environment({ HONOWARDEN_API: unsafeApi }),
    );

    expect(safe.headers.get("location")).toBe(
      "https://app.honowarden.com/account",
    );
    expect(unsafe.headers.get("location")).toBeNull();
    expect(unsafe.headers.get("nel")).toBeNull();
    expect(unsafe.headers.get("report-to")).toBeNull();
    expect(
      unsafe.headers.get("content-security-policy-report-only"),
    ).toBeNull();
  });

  it("rejects cross-origin state changes before the API binding is called", async () => {
    const api = fetcher(async () => new Response(null, { status: 204 }));

    const response = await handleRequest(
      new Request("https://app.honowarden.com/api/ciphers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: "{}",
      }),
      environment({ HONOWARDEN_API: api }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toMatchObject({
      error: "cross_origin_request_rejected",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-origin preflight and unsupported proxy methods", async () => {
    const api = fetcher(async () => new Response(null, { status: 204 }));

    const preflight = await handleRequest(
      new Request("https://app.honowarden.com/api/ciphers", {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
      environment({ HONOWARDEN_API: api }),
    );
    const unsupported = await handleRequest(
      new Request("https://app.honowarden.com/api/ciphers", {
        method: "PURGE",
      }),
      environment({ HONOWARDEN_API: api }),
    );

    expect(preflight.status).toBe(403);
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe(
      "GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE",
    );
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("requires a service binding in production instead of silently using public fetch", async () => {
    const publicFetch = vi.fn();
    vi.stubGlobal("fetch", publicFetch);

    try {
      const response = await handleRequest(
        new Request("https://app.honowarden.com/api/config"),
        environment({
          HONOWARDEN_API: undefined,
          HONOWARDEN_DEPLOYMENT_ENV: "production",
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_proxy_unavailable",
      });
      expect(publicFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed unless public fetch is explicitly scoped to a local or preview host", async () => {
    const publicFetch = vi.fn();
    vi.stubGlobal("fetch", publicFetch);

    try {
      const cases: Array<{
        url: string;
        deploymentEnvironment?: string;
        transport?: string;
      }> = [
        { url: "https://app.honowarden.com/api/config" },
        {
          url: "https://preview.example.workers.dev/api/config",
          deploymentEnvironment: "prodction",
          transport: "public-preview",
        },
        {
          url: "https://app.honowarden.com/api/config",
          deploymentEnvironment: "local",
          transport: "public-preview",
        },
        {
          url: "https://preview.example.workers.dev/api/config",
          deploymentEnvironment: "production",
          transport: "public-preview",
        },
        {
          url: "http://127.0.0.1:4176/api/config",
          deploymentEnvironment: "local",
        },
        {
          url: "https://preview.example.workers.dev/api/synthetic-probe",
          deploymentEnvironment: "local",
          transport: "public-preview",
        },
        {
          url: "http://127.0.0.1:4176/api/synthetic-probe",
          deploymentEnvironment: "preview",
          transport: "public-preview",
        },
      ];

      for (const testCase of cases) {
        const response = await handleRequest(
          new Request(testCase.url),
          environment({
            HONOWARDEN_API: undefined,
            HONOWARDEN_API_TRANSPORT: testCase.transport,
            HONOWARDEN_DEPLOYMENT_ENV: testCase.deploymentEnvironment,
          }),
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          error: "api_proxy_unavailable",
        });
      }
      expect(publicFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("allows public fetch only with explicit local or preview transport", async () => {
    const publicFetch = vi.fn(async () =>
      Response.json({ transport: "public-preview" }),
    );
    vi.stubGlobal("fetch", publicFetch);

    try {
      for (const testCase of [
        {
          url: "http://127.0.0.1:4176/api/synthetic-probe",
          environment: "local",
        },
        {
          url: "https://honowarden-preview.example.workers.dev/api/synthetic-probe",
          environment: "preview",
        },
      ]) {
        const response = await handleRequest(
          new Request(testCase.url),
          environment({
            HONOWARDEN_API: undefined,
            HONOWARDEN_API_TRANSPORT: "public-preview",
            HONOWARDEN_DEPLOYMENT_ENV: testCase.environment,
          }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          transport: "public-preview",
        });
      }
      expect(publicFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when the API origin is invalid or loops to the app origin", async () => {
    for (const apiOrigin of [
      "http://vault.honowarden.com",
      "https://user:secret@vault.honowarden.com",
      "https://app.honowarden.com",
    ]) {
      const response = await handleRequest(
        new Request("https://app.honowarden.com/api/config"),
        environment({ HONOWARDEN_API_ORIGIN: apiOrigin }),
      );

      expect(response.status).toBe(503);
      const body = (await response.json()) as { requestId: string };
      expect(body).toMatchObject({
        error: "api_proxy_unavailable",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(response.headers.get("x-request-id")).toBe(body.requestId);
    }
  });

  it("correlates production API failure logs with response request ids", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await handleRequest(
        new Request(
          "https://app.honowarden.com/api/config?note=vault-plaintext-secret",
          {
            headers: {
              cookie: "session=vault-plaintext-secret",
              authorization: "Bearer vault-plaintext-secret",
            },
          },
        ),
        environment({
          HONOWARDEN_API: undefined,
          HONOWARDEN_DEPLOYMENT_ENV: "production",
        }),
      );
      const body = (await response.json()) as { requestId: string };
      const logged = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;

      expect(response.headers.get("x-request-id")).toBe(body.requestId);
      expect(logged).toMatchObject({
        event: "api_proxy_binding_missing",
        requestId: body.requestId,
        method: "GET",
        pathClass: "api",
        status: 503,
        environment: "production",
      });
      expect(logged.durationMs).toEqual(expect.any(Number));
      expect(JSON.stringify(logged)).not.toContain("vault-plaintext-secret");
      expect(JSON.stringify(logged)).not.toContain("note=");
      expect(Object.keys(logged).sort()).toEqual(
        [
          "durationMs",
          "environment",
          "errorType",
          "event",
          "method",
          "pathClass",
          "requestId",
          "status",
        ].sort(),
      );
    } finally {
      error.mockRestore();
    }
  });
});
