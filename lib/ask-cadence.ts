/**
 * lib/ask-cadence.ts — hand a prefilled instruction to the assistant sheet.
 *
 * Server-rendered lists (the overflow card, for one) cannot reach the sheet's
 * React state, and prop-drilling a callback from the layout through a server
 * component is not possible. A window event is the smallest thing that works:
 * the dispatcher stays a plain client component and the sheet owns opening.
 */

export const ASK_CADENCE_EVENT = "cadence:ask";

export type AskCadenceDetail = { text: string };

/** Open the assistant with `text` already in the composer. */
export function askCadence(text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AskCadenceDetail>(ASK_CADENCE_EVENT, { detail: { text } }),
  );
}
