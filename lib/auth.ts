/**
 * lib/auth.ts — cookie + redirect helpers built on lib/session.ts.
 *
 * SPEC section 8: one user, one passphrase in APP_PASSPHRASE, an httpOnly signed
 * cookie valid for 30 days. No user tables, no OAuth.
 *
 * Server Functions are reachable by direct POST, so every page and every action
 * that touches data calls `requireAuth()` — the proxy is only a first line.
 */

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  checkPassphrase,
} from "./session";

export { checkPassphrase };

/** True when the current request carries a valid, unexpired session cookie. */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Redirects to /login when not signed in. Call at the top of every protected page. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }
}

/** Set the signed session cookie. Call from the login action after a good passphrase. */
export async function startSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Clear the session cookie. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
