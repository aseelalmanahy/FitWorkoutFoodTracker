/**
 * The page Content Security Policy. Scripts need this request's nonce or to come from this site, as Next.js
 * and the theme script are inline. pdf.js needs a worker and WebAssembly, and picked files are shown from
 * blob: URLs. Inline style attributes are allowed for progress bars and the photo crop box: they can't run code.
 */
export function contentSecurityPolicy(nonce: string, { development = false, https = false }: { development?: boolean; https?: boolean } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' blob:${development ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** A short lifetime first, as the design says: a mistake here can't be undone until it expires. No subdomains or preload, as no domain is chosen. */
export const HSTS_VALUE = "max-age=86400";

/** Only a deployment with an HTTPS origin. APP_ORIGIN is mandatory there, and it's checked at startup. */
export function isHttpsProduction(env: { NODE_ENV?: string; APP_ORIGIN?: string }): boolean {
  return env.NODE_ENV === "production" && (env.APP_ORIGIN ?? "").startsWith("https://");
}

/** Applied to every response, from next.config.ts. */
export const BASE_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/** API responses are data, and never a page: nothing in them may load or run, and no proxy may keep them. */
export const API_HEADERS = [
  { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
  { key: "Cache-Control", value: "no-store" },
];
