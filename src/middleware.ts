import { NextResponse, type NextRequest } from "next/server";
import { HSTS_VALUE, contentSecurityPolicy, isHttpsProduction } from "@/lib/security-headers";

const SIGNED_IN_ONLY = ["/dashboard", "/workouts", "/nutrition", "/progress", "/profile", "/onboarding", "/account-restricted", "/account", "/feedback", "/admin"];
const signedInOnly = (path: string) => SIGNED_IN_ONLY.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Every page: a fresh script nonce, its Content Security Policy, and HSTS on an HTTPS deployment. Next.js reads
 * the nonce from the request's policy. Also a cheap bounce for requests with no session cookie: real session
 * validation happens server-side in getCurrentUser().
 */
export function middleware(req: NextRequest) {
  const https = isHttpsProduction(process.env);
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development", https });

  let response: NextResponse;
  if (signedInOnly(req.nextUrl.pathname) && !req.cookies.has("fit_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    response = NextResponse.redirect(url);
  } else {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", policy);
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set("Content-Security-Policy", policy);
  if (https) response.headers.set("Strict-Transport-Security", HSTS_VALUE);
  return response;
}

// API routes are left out, as they have their own headers and must not have their upload bodies buffered here.
export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico).*)"],
};
