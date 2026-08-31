/**
 * proxy.ts — the request gate (formerly "middleware", renamed in Next.js 16).
 *
 * SPEC section 8: protect everything except /login and /api/capture.
 * This is a fast first check; the real enforcement is `requireAuth()` inside
 * every page and Server Action.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  // Remember where they were headed so login can send them back.
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from && from !== "/") loginUrl.searchParams.set("from", from);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except: the login page, the capture webhook (its own
  // bearer token), Next internals, and static assets.
  matcher: [
    "/((?!login|api/capture|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:png|svg|ico|webmanifest)$).*)",
  ],
};
