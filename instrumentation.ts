/**
 * instrumentation.ts — runs once when a Next.js server instance starts.
 *
 * Used for one thing: checking that every model id in lib/ai/models.ts actually
 * exists on this API key. A wrong id otherwise surfaces as a 404 buried inside
 * whichever mode happened to use it, which is a bad way to find out.
 *
 * `register()` must complete before the server serves requests, so the check is
 * time-bounded (5s) and can never throw. A dead network means "could not
 * check", never "refuse to boot".
 */

export async function register() {
  // register() also runs on the edge runtime, where this check does not belong
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { reportModelIds } = await import("@/lib/ai/model-check");
    await reportModelIds();
  } catch {
    // never let a diagnostic stop the server from starting
    console.warn("[models] startup check could not run");
  }
}
