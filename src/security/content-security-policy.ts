export const VITE_DEVELOPMENT_STYLE_NONCE = "honowarden-vite-development-style";

export function contentSecurityPolicy(viteDevelopment: boolean): string {
  const styleSource = viteDevelopment
    ? `style-src 'self' 'nonce-${VITE_DEVELOPMENT_STYLE_NONCE}'`
    : "style-src 'self'";

  return [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    styleSource,
    "worker-src 'self'",
    "trusted-types 'none'",
    "require-trusted-types-for 'script'",
  ].join("; ");
}
