/**
 * Turn a THROWN server-action failure into a line a person can act on.
 *
 * The actions return their expected failures — daily quota, rate limiting, a
 * spent call budget — as `{ ok: false, error }`, and those render fine. What
 * reaches here is the transport itself dying: a Vercel function killed at its
 * maxDuration ceiling, a dropped connection, a 500 from the Server Action
 * endpoint. Next.js surfaces those to the browser as a bare "Failed to fetch"
 * with no status code, so echoing the message tells the person nothing.
 *
 * Before this existed the rejection was unhandled and no error state was ever
 * set, so the button sat on "Replanning the rest of the day…" indefinitely.
 * A wrong guess at the cause is still better than silence; silence is
 * indistinguishable from the app having hung.
 */
import { unstable_rethrow } from "next/navigation";

export function describeThrown(e: unknown): string {
  // redirect() / notFound() throw framework-controlled errors that Next.js is
  // meant to handle — requireAuth() redirects to /login exactly this way.
  // Swallowing one would turn a bounce to the login page into a red error
  // message and strand the person. Rethrow before interpreting anything.
  unstable_rethrow(e);

  const msg = e instanceof Error ? e.message : String(e ?? "");

  if (/failed to fetch|networkerror|load failed|connection|aborted/i.test(msg)) {
    return (
      "The request never came back — the planner was cut off mid-call rather " +
      "than failing cleanly, so it could not say why. The server log for this " +
      "request has the real reason. Nothing was saved; try again."
    );
  }

  return msg
    ? `The planner failed: ${msg}. Nothing was saved; try again.`
    : "The planner failed without saying why. Nothing was saved; try again.";
}
