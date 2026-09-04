import { contentSecurityPolicy } from "./security/content-security-policy";

export interface WebVaultEnv {
  ASSETS: Fetcher;
  HONOWARDEN_API?: Fetcher | undefined;
  HONOWARDEN_API_ORIGIN: string;
  HONOWARDEN_API_TRANSPORT?: string | undefined;
  HONOWARDEN_DEPLOYMENT_ENV?: string | undefined;
}

type PathClass = "api" | "identity";

const SECURITY_HEADERS = {
  "Content-Security-Policy": contentSecurityPolicy(import.meta.env.DEV),
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": [
    "accelerometer=()",
    "camera=()",
    "display-capture=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=()",
    "publickey-credentials-create=()",
    "publickey-credentials-get=()",
    "usb=()",
  ].join(", "),
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Download-Options": "noopen",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
} as const;

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "bitwarden-client-name",
  "bitwarden-client-version",
  "bitwarden-package-type",
  "content-type",
  "device-identifier",
  "device-name",
  "device-type",
  "is-prerelease",
  "x-device-identifier",
  "x-device-name",
  "x-request-email",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "alt-svc",
  "clear-site-data",
  "content-security-policy-report-only",
  "link",
  "nel",
  "refresh",
  "report-to",
  "set-cookie",
  "set-cookie2",
  "timing-allow-origin",
]);

const FINGERPRINTED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;
const ALLOWED_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;
const ALLOWED_METHOD_SET = new Set<string>(ALLOWED_METHODS);
const ORIGIN_EXEMPT_METHODS = new Set(["GET", "HEAD"]);
const LOCAL_FALLBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SERVER_CONFIG_PATH = "/api/config";
const MAX_SERVER_CONFIG_BYTES = 64 * 1024;
const INVALIDATED_BODY_HEADERS = [
  "Content-Encoding",
  "Content-Length",
  "Content-MD5",
  "Digest",
  "ETag",
] as const;

class InvalidUpstreamConfigError extends Error {
  override name = "InvalidUpstreamConfigError";
}

const worker: ExportedHandler<WebVaultEnv> = {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default worker;

export async function handleRequest(
  request: Request,
  env: WebVaultEnv,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const pathClass = classifyApiPath(requestUrl.pathname);

  if (pathClass) {
    return proxyApiRequest(request, env, requestUrl, pathClass);
  }

  const startedAt = performance.now();
  try {
    const response = await env.ASSETS.fetch(request);
    return secureResponse(response, requestUrl, false);
  } catch (error) {
    const requestId = crypto.randomUUID();
    logFailure(env, {
      event: "static_asset_failure",
      requestId,
      method: request.method,
      pathClass: "static",
      status: 503,
      durationMs: performance.now() - startedAt,
      error,
    });
    return secureResponse(
      jsonError("web_vault_unavailable", 503, requestId),
      requestUrl,
      false,
      requestId,
    );
  }
}

async function proxyApiRequest(
  request: Request,
  env: WebVaultEnv,
  requestUrl: URL,
  pathClass: PathClass,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const method = request.method.toUpperCase();

  if (!ALLOWED_METHOD_SET.has(method)) {
    const response = jsonError("method_not_allowed", 405, requestId);
    response.headers.set("Allow", ALLOWED_METHODS.join(", "));
    return secureResponse(response, requestUrl, true, requestId);
  }

  const apiOrigin = parseApiOrigin(
    env.HONOWARDEN_API_ORIGIN,
    requestUrl.origin,
  );

  if (!apiOrigin) {
    logFailure(env, {
      event: "api_proxy_configuration_failure",
      requestId,
      method: request.method,
      pathClass,
      status: 503,
      durationMs: performance.now() - startedAt,
    });
    return secureResponse(
      jsonError("api_proxy_unavailable", 503, requestId),
      requestUrl,
      true,
      requestId,
    );
  }

  if (
    !env.HONOWARDEN_API &&
    !allowsPublicApiFallback(env, requestUrl.hostname)
  ) {
    logFailure(env, {
      event: "api_proxy_binding_missing",
      requestId,
      method: request.method,
      pathClass,
      status: 503,
      durationMs: performance.now() - startedAt,
    });
    return secureResponse(
      jsonError("api_proxy_unavailable", 503, requestId),
      requestUrl,
      true,
      requestId,
    );
  }

  if (!isSameOriginMutation(request, requestUrl.origin)) {
    logCompletion(env, {
      event: "api_proxy_rejected",
      requestId,
      method: request.method,
      pathClass,
      status: 403,
      durationMs: performance.now() - startedAt,
    });
    return secureResponse(
      jsonError("cross_origin_request_rejected", 403, requestId),
      requestUrl,
      true,
      requestId,
    );
  }

  const target = new URL(requestUrl.pathname + requestUrl.search, apiOrigin);
  const headers = proxyRequestHeaders(request.headers, apiOrigin.origin);
  headers.set("X-Request-Id", requestId);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const upstreamRequest = new Request(target, init);
    const response = env.HONOWARDEN_API
      ? await env.HONOWARDEN_API.fetch(upstreamRequest)
      : await fetch(upstreamRequest);
    const secured = secureResponse(
      await proxyResponse(
        response,
        apiOrigin.origin,
        requestUrl.origin,
        method === "GET" && requestUrl.pathname === SERVER_CONFIG_PATH,
      ),
      requestUrl,
      true,
      requestId,
    );
    logCompletion(env, {
      event: "api_proxy_complete",
      requestId,
      method: request.method,
      pathClass,
      status: secured.status,
      durationMs: performance.now() - startedAt,
    });
    return secured;
  } catch (error) {
    const invalidConfig = error instanceof InvalidUpstreamConfigError;
    logFailure(env, {
      event: invalidConfig
        ? "api_proxy_invalid_config"
        : "api_proxy_upstream_failure",
      requestId,
      method: request.method,
      pathClass,
      status: 502,
      durationMs: performance.now() - startedAt,
      error,
    });
    return secureResponse(
      jsonError(
        invalidConfig
          ? "api_upstream_invalid_response"
          : "api_upstream_unavailable",
        502,
        requestId,
      ),
      requestUrl,
      true,
      requestId,
    );
  }
}

function classifyApiPath(pathname: string): PathClass | null {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return "api";
  }
  if (pathname === "/identity" || pathname.startsWith("/identity/")) {
    return "identity";
  }
  return null;
}

function parseApiOrigin(value: string, appOrigin: string): URL | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin === appOrigin
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function allowsPublicApiFallback(
  env: WebVaultEnv,
  requestHostname: string,
): boolean {
  if (env.HONOWARDEN_API_TRANSPORT !== "public-preview") {
    return false;
  }

  const hostname = requestHostname.toLowerCase();
  if (env.HONOWARDEN_DEPLOYMENT_ENV === "local") {
    return LOCAL_FALLBACK_HOSTS.has(hostname);
  }
  if (env.HONOWARDEN_DEPLOYMENT_ENV === "preview") {
    return hostname.endsWith(".workers.dev");
  }
  return false;
}

function isSameOriginMutation(request: Request, appOrigin: string): boolean {
  if (ORIGIN_EXEMPT_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return (
    origin === appOrigin &&
    (!fetchSite || fetchSite.toLowerCase() === "same-origin")
  );
}

function proxyRequestHeaders(source: Headers, apiOrigin: string): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.append(name, value);
    }
  }
  if (source.has("Origin")) {
    headers.set("Origin", apiOrigin);
  }
  return headers;
}

async function proxyResponse(
  response: Response,
  apiOrigin: string,
  appOrigin: string,
  rewriteServerConfig: boolean,
): Promise<Response> {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.append(name, value);
    }
  }

  const location = headers.get("Location");
  if (location) {
    try {
      const redirect = new URL(location, apiOrigin);
      if (
        redirect.origin === apiOrigin &&
        !redirect.username &&
        !redirect.password &&
        !redirect.search &&
        !redirect.hash
      ) {
        redirect.protocol = new URL(appOrigin).protocol;
        redirect.host = new URL(appOrigin).host;
        headers.set("Location", redirect.toString());
      } else {
        headers.delete("Location");
      }
    } catch {
      headers.delete("Location");
    }
  }

  let body: BodyInit | null = response.body;
  if (rewriteServerConfig && response.ok) {
    body = await rewriteServerConfigBody(response, apiOrigin, appOrigin);
    headers.set("Content-Type", "application/json; charset=utf-8");
    for (const name of INVALIDATED_BODY_HEADERS) {
      headers.delete(name);
    }
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rewriteServerConfigBody(
  response: Response,
  apiOrigin: string,
  appOrigin: string,
): Promise<string> {
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new InvalidUpstreamConfigError();
  }

  const text = await readBoundedUtf8(response, MAX_SERVER_CONFIG_BYTES);
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    throw new InvalidUpstreamConfigError();
  }

  if (!isRecord(config) || config.object !== "config") {
    throw new InvalidUpstreamConfigError();
  }
  const environment = config.environment;
  if (!isRecord(environment)) {
    throw new InvalidUpstreamConfigError();
  }

  const expectedUpstreamUrls = {
    vault: apiOrigin,
    api: `${apiOrigin}/api`,
    identity: `${apiOrigin}/identity`,
    notifications: `${apiOrigin}/notifications`,
  } as const;
  for (const [name, value] of Object.entries(expectedUpstreamUrls)) {
    if (environment[name] !== value) {
      throw new InvalidUpstreamConfigError();
    }
  }

  return JSON.stringify({
    ...config,
    environment: {
      ...environment,
      vault: appOrigin,
      api: `${appOrigin}/api`,
      identity: `${appOrigin}/identity`,
    },
  });
}

async function readBoundedUtf8(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maxBytes
    ) {
      throw new InvalidUpstreamConfigError();
    }
  }
  if (!response.body) {
    throw new InvalidUpstreamConfigError();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new InvalidUpstreamConfigError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof InvalidUpstreamConfigError) {
      throw error;
    }
    throw new InvalidUpstreamConfigError();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidUpstreamConfigError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function secureResponse(
  response: Response,
  requestUrl: URL,
  isApi: boolean,
  requestId?: string,
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set(
    "Cache-Control",
    isImmutableAssetResponse(response, requestUrl, isApi)
      ? "public, max-age=31536000, immutable"
      : "no-store",
  );
  if (requestId) {
    headers.set("X-Request-Id", requestId);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isImmutableAssetResponse(
  response: Response,
  requestUrl: URL,
  isApi: boolean,
): boolean {
  if (
    isApi ||
    response.status !== 200 ||
    !FINGERPRINTED_ASSET.test(requestUrl.pathname)
  ) {
    return false;
  }

  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return Boolean(
    contentType &&
    contentType !== "text/html" &&
    contentType !== "application/xhtml+xml",
  );
}

function jsonError(
  error: string,
  status: number,
  requestId?: string,
): Response {
  const body = requestId ? { error, requestId } : { error };
  return Response.json(body, { status });
}

function logCompletion(
  env: WebVaultEnv,
  event: {
    event: string;
    requestId: string;
    method: string;
    pathClass: PathClass;
    status: number;
    durationMs: number;
  },
): void {
  if (env.HONOWARDEN_DEPLOYMENT_ENV === "test") {
    return;
  }
  console.info(
    JSON.stringify({
      ...event,
      durationMs: Math.round(event.durationMs),
      environment: env.HONOWARDEN_DEPLOYMENT_ENV ?? "unconfigured",
    }),
  );
}

function logFailure(
  env: WebVaultEnv,
  failure: {
    event: string;
    requestId: string;
    method: string;
    pathClass: PathClass | "static";
    status: number;
    durationMs: number;
    error?: unknown;
  },
): void {
  if (env.HONOWARDEN_DEPLOYMENT_ENV === "test") {
    return;
  }
  const { error, ...event } = failure;
  console.error(
    JSON.stringify({
      ...event,
      durationMs: Math.round(event.durationMs),
      environment: env.HONOWARDEN_DEPLOYMENT_ENV ?? "unconfigured",
      errorType: error instanceof Error ? error.name : "Error",
    }),
  );
}
