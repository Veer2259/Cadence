/**
 * lib/ai/modes/breakdown.ts — SPEC 6.7. The conversational goal-setting mode.
 *
 * Runs on the STRONGEST model available (role "reason"), because it happens a
 * few times a quarter and the quality of the argument matters more than the
 * cost. Compose, which runs daily, stays on the cheaper model.
 *
 * This mode never writes. It returns a reply and, once it has enough, a
 * proposal that goes to a review list the person confirms or edits.
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buckets } from "@/db/schema";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { breakdownTurnSchema, type BreakdownTurn } from "@/lib/ai/schemas";
import { BREAKDOWN_SYSTEM_PROMPT } from "@/lib/ai/prompts/breakdown";
import { capacityEvidence } from "@/lib/capacity";
import { weekStartOf } from "@/lib/goals";
import { istToday, addIstDays } from "@/lib/time";

export type BreakdownMessage = { role: "user" | "assistant"; content: string };

export type BreakdownState = {
  messages: BreakdownMessage[];
  /** the last proposal offered, if any */
  proposal: BreakdownTurn["proposal"];
};

/** The stored dialogue for a bucket, so the reasoning stays readable later. */
export async function loadTranscript(bucketId: string): Promise<BreakdownState> {
  const row = await db.query.buckets.findFirst({ where: eq(buckets.id, bucketId) });
  const t = (row?.breakdownTranscript ?? null) as BreakdownState | null;
  return t && Array.isArray(t.messages) ? t : { messages: [], proposal: null };
}

export async function saveTranscript(
  bucketId: string,
  state: BreakdownState,
): Promise<void> {
  await db
    .update(buckets)
    .set({ breakdownTranscript: state })
    .where(eq(buckets.id, bucketId));
}

/**
 * One turn of the dialogue. Returns the reply and any proposal; the caller
 * persists the transcript and shows the proposal for review.
 */
export async function breakdownTurn(args: {
  bucketId: string;
  userText: string;
  now?: Date;
}): Promise<{ turn: BreakdownTurn; state: BreakdownState }> {
  const now = args.now ?? new Date();
  const today = istToday(now);

  const bucket = await db.query.buckets.findFirst({
    where: eq(buckets.id, args.bucketId),
  });
  if (!bucket) throw new Error("That bucket does not exist.");

  const state = await loadTranscript(args.bucketId);
  const evidence = await capacityEvidence(8, today);

  // The model has no clock and no memory of their history — hand it both.
  const context = {
    today,
    nextMonday: addIstDays(weekStartOf(today), 7),
    bucket: {
      name: bucket.name,
      currentOutcome: bucket.outcome,
      currentTargetDate: bucket.outcomeTargetDate,
      status: bucket.status,
    },
    capacity: evidence,
  };

  const messages: { role: "user" | "model"; content: string }[] = [
    {
      role: "user",
      content:
        `Context (their real history — use these numbers when you push back):\n` +
        `${JSON.stringify(context, null, 2)}\n\n` +
        (state.messages.length === 0
          ? `This is the start of the conversation. Open by asking what they are ` +
            `actually trying to achieve in this bucket — do not propose anything yet.`
          : `Continue the conversation.`),
    },
    ...state.messages.map((m) => ({
      role: (m.role === "user" ? "user" : "model") as "user" | "model",
      content: m.content,
    })),
    { role: "user" as const, content: args.userText },
  ];

  const turn = await runStructured({
    role: "reason",
    purpose: "breakdown",
    budget: new CallBudget(BUDGET.breakdownTurn, "breakdown"),
    system: BREAKDOWN_SYSTEM_PROMPT,
    schema: breakdownTurnSchema,
    schemaName: "breakdown_turn",
    messages,
  });

  const next: BreakdownState = {
    messages: [
      ...state.messages,
      { role: "user" as const, content: args.userText },
      { role: "assistant" as const, content: turn.reply },
    ].slice(-40),
    proposal: turn.proposal ?? state.proposal,
  };
  await saveTranscript(args.bucketId, next);

  return { turn, state: next };
}
