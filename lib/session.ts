/**
 * lib/session.ts — pure session-token logic, no framework imports.
 *
 * Kept separate from lib/auth.ts (which touches cookies) so that proxy.ts can
 * import the verifier without pulling in `next/headers`.
 *
 * Token shape:  base64url(JSON({ v, exp })) + "." + base64url(HMAC-SHA256(payload))
 * The signature is what makes the cookie tamper-proof; `exp` is a unix seconds
 * timestamp, checked on every request.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";

export const SESSION_COOKIE = "cadence_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a long random string in .env.local.",
    );
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

/** Constant-time string comparison that tolerates length differences. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Build a fresh signed token that expires `SESSION_TTL_SECONDS` from now. */
export function createSessionToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payloadB64 = b64url(JSON.stringify({ v: 1, exp }));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify signature and expiry. Returns true only for a valid, unexpired token. */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = sign(payloadB64);
  if (sig.length !== expectedSig.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
      exp?: number;
    };
    if (typeof payload.exp !== "number") return false;
    return payload.exp * 1000 > now;
  } catch {
    return false;
  }
}

/**
 * Compare a submitted passphrase against APP_PASSPHRASE in constant time.
 * Returns false (never throws) when APP_PASSPHRASE is unset, so the app fails
 * closed if it is misconfigured.
 */
export function checkPassphrase(input: string): boolean {
  const expected = process.env.APP_PASSPHRASE;
  if (!expected) return false;
  return safeEqual(input, expected);
}
