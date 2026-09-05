/**
 * lib/ai/modes/timetable.ts — parse a timetable PDF into dated sessions.
 *
 * The file and the instruction go to the model in ONE call, through the normal
 * provider layer (runStructured + InputFile). No vendor SDK is touched here:
 * the adapters know how to attach a document, and switching LLM_PROVIDER keeps
 * working.
 *
 * Runs on the `reason` role. It is a careful read of a dense table where a
 * wrong date is expensive and it happens a few times a term, so it can afford
 * the better model.
 *
 * This mode NEVER writes. It returns a parse for a review list.
 */

import "server-only";
import { runStructured, CallBudget, type InputFile } from "@/lib/ai/provider";
import { timetableParse, type TimetableParse } from "@/lib/schemas";
import { TIMETABLE_SYSTEM_PROMPT } from "@/lib/ai/prompts/timetable";
import { istToday, formatIst } from "@/lib/time";

/** A timetable is one dense page; two attempts is plenty. */
const TIMETABLE_BUDGET = 2;
/** Anthropic caps a request at 32MB; a timetable that big is not a timetable. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

export async function parseTimetable(args: {
  /** base64 PDF, no newlines */
  pdfBase64: string;
  fileName?: string;
  /** the person's free-text instruction — how to read the sheet */
  instruction: string;
  now?: Date;
}): Promise<TimetableParse> {
  const now = args.now ?? new Date();

  const files: InputFile[] = [
    { data: args.pdfBase64, mediaType: "application/pdf", name: args.fileName },
  ];

  // The model has no clock. It is told today's date ONLY so it can sanity-check
  // the term range and flag one that looks wrong — never to date a session
  // from. The system prompt says so explicitly.
  const context =
    `Today is ${formatIst(now, "EEEE d MMMM yyyy")} (${istToday(now)}), Asia/Kolkata.\n` +
    `Use that ONLY to sanity-check the term dates on the sheet. Never use it to ` +
    `date a session — a session you cannot date from the PDF gets date: null.\n\n` +
    `How to read this timetable, in their words:\n${args.instruction.trim() || "(no instruction given)"}`;

  return runStructured({
    role: "reason",
    purpose: "timetable",
    budget: new CallBudget(TIMETABLE_BUDGET, "timetable"),
    system: TIMETABLE_SYSTEM_PROMPT,
    schema: timetableParse,
    schemaName: "timetable_parse",
    files,
    messages: [{ role: "user", content: context }],
  });
}
