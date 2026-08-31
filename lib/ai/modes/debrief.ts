/**
 * lib/ai/modes/debrief.ts — the one cheap model call in the debrief flow
 * (SPEC 6.4): a two-line descriptive summary. Runs on the `capture` model.
 *
 * All the arithmetic is done in code; the model only phrases it.
 */

import "server-only";
import { runStructured, StructuredOutputError, CallBudget } from "@/lib/ai/provider";
import { debriefSummarySchema } from "@/lib/ai/schemas";
import { DEBRIEF_SYSTEM_PROMPT } from "@/lib/ai/prompts/debrief";

export type DebriefDigest = {
  date: string;
  plannedMin: number;
  loggedMin: number;
  byCategory: { category: string; plannedMin: number; loggedMin: number; deltaMin: number }[];
  skipped: string[];
  partial: string[];
  carriedOver: number;
};

/** Deterministic fallback used when the model is unavailable. */
export function fallbackSummary(d: DebriefDigest): string {
  const h = (m: number) => (m / 60).toFixed(1).replace(/\.0$/, "");
  const parts = [`${h(d.loggedMin)}h logged against ${h(d.plannedMin)}h planned.`];
  const worst = [...d.byCategory]
    .filter((c) => Math.abs(c.deltaMin) >= 15)
    .sort((a, b) => Math.abs(b.deltaMin) - Math.abs(a.deltaMin))[0];
  if (worst) {
    parts.push(
      `${worst.category} ran ${Math.abs(worst.deltaMin)} min ${worst.deltaMin > 0 ? "over" : "under"}.`,
    );
  }
  if (d.skipped.length) {
    parts.push(
      d.skipped.length === 1
        ? `${d.skipped[0]} did not happen.`
        : `${d.skipped.length} blocks were skipped.`,
    );
  }
  return parts.join(" ");
}

export async function summariseDebrief(digest: DebriefDigest): Promise<string> {
  try {
    const { summary } = await runStructured({
      role: "capture",
      purpose: "debrief-summary",
      budget: new CallBudget(2, "debrief-summary"),
      system: DEBRIEF_SYSTEM_PROMPT,
      schema: debriefSummarySchema,
      schemaName: "debrief_summary",
      messages: [
        {
          role: "user",
          content: `Summarise this day.\n\n${JSON.stringify(digest, null, 2)}`,
        },
      ],
    });
    return summary.trim() || fallbackSummary(digest);
  } catch (e) {
    if (!(e instanceof StructuredOutputError)) console.error("[debrief] summary failed:", e);
    return fallbackSummary(digest);
  }
}
