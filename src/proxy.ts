import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession, passwordGateEnabled } from "./lib/session";

// With SITE_PASSWORD set, every page except /login needs a valid session (pages re-check on the server).
// Without it, access control is Vercel Authentication's job.
export function proxy(request: NextRequest) {
  if (!passwordGateEnabled()) return NextResponse.next(); // protected by Vercel Authentication instead
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
