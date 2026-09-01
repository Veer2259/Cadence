/**
 * lib/ai/modes/kickoff.ts — SPEC 6.8. Given this week's targets, propose the
 * candidate tasks that would deliver them.
 *
 * Like breakdown, this never writes: it returns candidates for a review list
 * the person confirms or edits. Runs on the compose model — it is a sizing job,
 * not an argument.
 */

import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { kickoffSchema, type KickoffResult } from "@/lib/ai/schemas";
import { KICKOFF_SYSTEM_PROMPT } from "@/lib/ai/prompts/kickoff";
import { capacityEvidence } from "@/lib/capacity";
import { weeklyTargetsFor } from "@/lib/goals";
import { istToday } from "@/lib/time";

export type KickoffOutcome = {
  result: KickoffResult;
  /** target ids that were offered to the model, for validating what came back */
  targetIds: string[];
};

export async function proposeWeek(
  weekStart: string,
  now: Date = new Date(),
): Promise<KickoffOutcome> {
  const targets = await weeklyTargetsFor(weekStart);
  if (targets.length === 0) {
    return { result: { candidates: [], note: "No targets set for this week." }, targetIds: [] };
  }

  // what is already linked, so nothing gets proposed twice
  const existing = await db
    .select({ id: tasks.id, title: tasks.title, weeklyTargetId: tasks.weeklyTargetId })
    .from(tasks)
    .where(
      and(
        inArray(tasks.weeklyTargetId, targets.map((t) => t.id)),
        sql`${tasks.status} <> 'dropped'`,
      ),
    );

  const evidence = await capacityEvidence(8, istToday(now));

  const payload = {
    weekStart,
    targets: targets.map((t) => ({
      id: t.id,
      bucket: t.bucketName,
      description: t.description,
      targetHours: t.targetHours,
      alreadyLinked: existing
        .filter((e) => e.weeklyTargetId === t.id)
        .map((e) => e.title),
    })),
    capacity: evidence,
  };

  const result = await runStructured({
    role: "compose",
    purpose: "kickoff",
    budget: new CallBudget(BUDGET.kickoff, "kickoff"),
    system: KICKOFF_SYSTEM_PROMPT,
    schema: kickoffSchema,
    schemaName: "week_kickoff",
    messages: [
      {
        role: "user",
        content:
          `This week's targets and their history. Propose the tasks that would ` +
          `deliver them.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  // Drop anything pointing at a target we did not offer — the model does not
  // get to invent ids, and a bad id would silently orphan the task.
  const targetIds = targets.map((t) => t.id);
  const clean: KickoffResult = {
    ...result,
    candidates: result.candidates.filter((c) => targetIds.includes(c.weeklyTargetId)),
  };

  return { result: clean, targetIds };
}
