/**
 * lib/ai/modes/kickoff.ts — SPEC 6.8, widened. Propose the tasks that would
 * deliver a goal, either through this week's targets or straight against the
 * goal itself.
 *
 * WHY IT TAKES TWO SHAPES. Task generation used to require weekly targets, and
 * returned early with zero candidates when there were none — before spending a
 * model call. For a goal inside the short horizon the breakdown mode correctly
 * proposes NO weekly targets (there are no whole weeks between now and the
 * deadline), so the pipeline dead-ended: an outcome was saved, no targets were
 * written, kickoff found nothing, and no tasks were ever produced. Nothing
 * errored; it simply looked like the model had no suggestions.
 *
 * So: more than SHORT_HORIZON_WEEKS away, propose against the week's targets.
 * At or inside it, propose against the goal, with weeklyTargetId null.
 *
 * Like breakdown, this NEVER writes. Candidates go to a review list.
 */

import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buckets, tasks } from "@/db/schema";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { kickoffSchema, type KickoffResult } from "@/lib/ai/schemas";
import { KICKOFF_SYSTEM_PROMPT } from "@/lib/ai/prompts/kickoff";
import { capacityEvidence } from "@/lib/capacity";
import { weeklyTargetsFor, weekStartOf } from "@/lib/goals";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { goalHorizon } from "@/lib/goal-horizon";
import { sizeCandidates } from "@/lib/task-sizing";
import { istToday } from "@/lib/time";

export type KickoffOutcome = {
  result: KickoffResult;
  /** target ids offered to the model, for validating what came back */
  targetIds: string[];
  /** which shape was used, so the UI can say what it did */
  mode: "targets" | "direct";
  /** the bucket proposed against, when running direct */
  bucketId: string | null;
};

/**
 * Propose tasks for a goal.
 *
 * `bucketId` selects the goal. Omit it to keep the old behaviour of proposing
 * against every target set for the week.
 */
export async function proposeTasks(args: {
  weekStart?: string;
  bucketId?: string | null;
  now?: Date;
}): Promise<KickoffOutcome> {
  const now = args.now ?? new Date();
  const today = istToday(now);
  const weekStart = args.weekStart ?? weekStartOf(today);

  const profile = await getOrCreateDayProfile();
  const bounds = { minBlockMin: profile.minBlockMin, maxBlockMin: profile.maxBlockMin };
  const evidence = await capacityEvidence(8, today);

  const bucket = args.bucketId
    ? ((await db.query.buckets.findFirst({ where: eq(buckets.id, args.bucketId) })) ?? null)
    : null;

  const horizon = goalHorizon(bucket?.outcomeTargetDate ?? null, today);
  // Direct only makes sense when we know which goal we are serving.
  const mode: "targets" | "direct" =
    bucket && horizon.mode !== "targets" ? "direct" : "targets";

  if (mode === "direct" && bucket) {
    return proposeAgainstGoal({ bucket, horizon, evidence, bounds, today });
  }

  const targets = (await weeklyTargetsFor(weekStart)).filter(
    (t) => !args.bucketId || t.bucketId === args.bucketId,
  );

  if (targets.length === 0) {
    // No longer a silent dead end: say which of the two shapes could not run
    // and why, so the screen can show something actionable.
    return {
      result: {
        candidates: [],
        note: bucket
          ? `${bucket.name} has no weekly targets for the week of ${weekStart}, and no outcome target date to plan directly against. Set an outcome date, or add a target for this week.`
          : `No targets set for the week of ${weekStart}.`,
      },
      targetIds: [],
      mode: "targets",
      bucketId: args.bucketId ?? null,
    };
  }

  // what is already linked, so nothing gets proposed twice
  const existing = await db
    .select({ id: tasks.id, title: tasks.title, weeklyTargetId: tasks.weeklyTargetId })
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.weeklyTargetId,
          targets.map((t) => t.id),
        ),
        sql`${tasks.status} <> 'dropped'`,
      ),
    );

  const payload = {
    weekStart,
    sittingMinutes: { min: Math.max(30, bounds.minBlockMin), max: Math.min(120, bounds.maxBlockMin) },
    targets: targets.map((t) => ({
      id: t.id,
      bucket: t.bucketName,
      description: t.description,
      targetHours: t.targetHours,
      alreadyLinked: existing.filter((e) => e.weeklyTargetId === t.id).map((e) => e.title),
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

  // The model does not get to invent ids: a bad one would silently orphan the
  // task. Null is legitimate here only in direct mode, so drop it too.
  const targetIds = targets.map((t) => t.id);
  const clean: KickoffResult = {
    ...result,
    candidates: sizeCandidates(
      result.candidates.filter(
        (c) => c.weeklyTargetId !== null && targetIds.includes(c.weeklyTargetId),
      ),
      bounds,
    ),
  };

  return { result: clean, targetIds, mode: "targets", bucketId: args.bucketId ?? null };
}

/** Tasks straight against the goal — no weekly-target layer to hang them on. */
async function proposeAgainstGoal(args: {
  bucket: typeof buckets.$inferSelect;
  horizon: ReturnType<typeof goalHorizon>;
  evidence: Awaited<ReturnType<typeof capacityEvidence>>;
  bounds: { minBlockMin: number; maxBlockMin: number };
  today: string;
}): Promise<KickoffOutcome> {
  const { bucket, horizon, evidence, bounds, today } = args;

  const existing = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.bucketId, bucket.id), sql`${tasks.status} not in ('done','dropped')`));

  const payload = {
    today,
    goal: {
      bucket: bucket.name,
      outcome: bucket.outcome,
      targetDate: bucket.outcomeTargetDate,
      daysLeft: horizon.days,
    },
    sittingMinutes: {
      min: Math.max(30, bounds.minBlockMin),
      max: Math.min(120, bounds.maxBlockMin),
    },
    alreadyOpen: existing.map((e) => e.title),
    capacity: evidence,
  };

  const result = await runStructured({
    role: "compose",
    purpose: "kickoff:direct",
    budget: new CallBudget(BUDGET.kickoff, "kickoff"),
    system:
      `${KICKOFF_SYSTEM_PROMPT}\n\n` +
      `THIS GOAL HAS NO WEEKLY TARGETS. Its deadline is close enough that ` +
      `slicing it into weeks would add a layer without adding information, so ` +
      `propose tasks DIRECTLY against the outcome and set \`weeklyTargetId\` to ` +
      `null on every candidate. Work back from the deadline: what has to be ` +
      `true by then, and what are the concrete sittings that get there. Say in ` +
      `\`note\` if the days remaining do not cover the work, with the numbers.`,
    schema: kickoffSchema,
    schemaName: "goal_kickoff",
    messages: [
      {
        role: "user",
        content:
          `This goal and the person's real capacity. Propose the tasks that ` +
          `would deliver it.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const clean: KickoffResult = {
    ...result,
    // Direct mode has no ids to point at; anything the model invented is dropped.
    candidates: sizeCandidates(
      result.candidates.map((c) => ({ ...c, weeklyTargetId: null })),
      bounds,
    ),
  };

  return { result: clean, targetIds: [], mode: "direct", bucketId: bucket.id };
}

/** Back-compat for callers that only ever wanted the week's targets. */
export async function proposeWeek(
  weekStart: string,
  now: Date = new Date(),
): Promise<KickoffOutcome> {
  return proposeTasks({ weekStart, now });
}
