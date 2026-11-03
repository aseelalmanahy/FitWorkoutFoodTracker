import { NextResponse, type NextRequest } from "next/server";

// Cheap edge gate: bounce requests without a session cookie. Real session
// validation happens server-side in getCurrentUser().
export function middleware(req: NextRequest) {
  if (!req.cookies.has("fit_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/workouts/:path*", "/nutrition/:path*", "/progress/:path*", "/profile/:path*", "/onboarding"],
};
