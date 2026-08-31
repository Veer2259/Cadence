/**
 * lib/plan.ts — persist and read time-blocked plans.
 *
 * At most one committed plan per date. A rebalance draft is allowed to coexist
 * with its committed parent (SPEC 6.3); the "one draft per date" half is
 * enforced here. Committing supersedes every other live plan for that date.
 */

import "server-only";
import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { plans, blocks, overflow, type Plan, type Block, type OverflowRow } from "@/db/schema";
import { istDayInstant } from "@/lib/time";
import type { ComposeInput } from "@/lib/ai/compose-types";
import type { PlanResult } from "@/lib/ai/schemas";

export type LivePlan = {
  plan: Plan;
  blocks: Block[];
  overflow: OverflowRow[];
};

/** The live plan for an IST date (a draft takes precedence over its committed parent). */
export async function getLivePlan(dateStr: string): Promise<LivePlan | null> {
  const row = await db.query.plans.findFirst({
    where: and(eq(plans.date, dateStr), inArray(plans.status, ["draft", "committed"])),
    orderBy: [sql`case when ${plans.status} = 'draft' then 0 else 1 end`],
  });
  if (!row) return null;

  const [bl, ov] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.planId, row.id)).orderBy(asc(blocks.startAt)),
    db.select().from(overflow).where(eq(overflow.planId, row.id)),
  ]);
  return { plan: row, blocks: bl, overflow: ov };
}

/** The committed, not-yet-debriefed plan for a date (the rebalance parent). */
export async function getCommittedPlan(dateStr: string): Promise<LivePlan | null> {
  const row = await db.query.plans.findFirst({
    where: and(eq(plans.date, dateStr), eq(plans.status, "committed")),
  });
  if (!row) return null;
  const [bl, ov] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.planId, row.id)).orderBy(asc(blocks.startAt)),
    db.select().from(overflow).where(eq(overflow.planId, row.id)),
  ]);
  return { plan: row, blocks: bl, overflow: ov };
}

/**
 * Write a fresh draft plan for `dateStr`, replacing any existing draft.
 * Without `parentPlanId` (a compose), it refuses if a committed plan exists.
 * With `parentPlanId` (a rebalance), the committed parent is expected; the given
 * `preservedBlocks` are copied verbatim into the new plan (SPEC 6.3).
 */
export async function saveDraftPlan(args: {
  dateStr: string;
  model: string;
  input: ComposeInput;
  plan: PlanResult;
  parentPlanId?: string;
  preservedBlocks?: Block[];
  /** stored as input_snapshot instead of `input` (used by rebalance) */
  inputSnapshotOverride?: unknown;
}): Promise<string> {
  const { dateStr, model, input, plan, parentPlanId, preservedBlocks = [] } = args;
  const taskIds = new Set(input.tasks.map((t) => t.id));
  const rawByTask = new Map(input.tasks.map((t) => [t.id, t.rawEstimateMin]));

  return db.transaction(async (tx) => {
    const existingDraft = await tx.query.plans.findFirst({
      where: and(eq(plans.date, dateStr), eq(plans.status, "draft")),
    });
    if (existingDraft) {
      await tx.delete(plans).where(eq(plans.id, existingDraft.id)); // cascades
    }

    if (!parentPlanId) {
      const committed = await tx.query.plans.findFirst({
        where: and(eq(plans.date, dateStr), eq(plans.status, "committed")),
      });
      if (committed) {
        throw new Error(
          "A committed plan already exists for this date. Rebalance it instead of re-planning.",
        );
      }
    }

    const [planRow] = await tx
      .insert(plans)
      .values({
        date: dateStr,
        status: "draft",
        model,
        inputSnapshot: args.inputSnapshotOverride ?? input,
        outputSnapshot: plan,
        parentPlanId: parentPlanId ?? null,
      })
      .returning();

    // preserved blocks — verbatim, new plan id
    const preservedRows = preservedBlocks.map((b) => ({
      planId: planRow.id,
      taskId: b.taskId,
      habitId: b.habitId,
      startAt: b.startAt,
      endAt: b.endAt,
      kind: b.kind,
      title: b.title,
      category: b.category,
      reason: b.reason,
      estimateMin: b.estimateMin,
      rawEstimateMin: b.rawEstimateMin,
      status: b.status,
      actualMin: b.actualMin,
    }));

    const newRows = plan.blocks.map((b) => {
      const isTask = b.kind === "task" && !!b.taskId && taskIds.has(b.taskId);
      return {
        planId: planRow.id,
        taskId: isTask ? b.taskId! : null,
        habitId: null,
        startAt: istDayInstant(dateStr, b.start),
        endAt: istDayInstant(dateStr, b.end),
        kind: b.kind,
        title: b.title,
        category: b.category,
        reason: b.reason,
        estimateMin: b.estimateMin,
        rawEstimateMin: isTask ? (rawByTask.get(b.taskId!) ?? b.estimateMin) : b.estimateMin,
        status: "planned" as const,
      };
    });

    const allRows = [...preservedRows, ...newRows];
    if (allRows.length) await tx.insert(blocks).values(allRows);

    const overflowRows = plan.overflow
      .filter((o) => taskIds.has(o.taskId))
      .map((o) => ({
        planId: planRow.id,
        taskId: o.taskId,
        reason: o.reason,
        action: o.action,
        suggestion: o.suggestion,
      }));
    if (overflowRows.length) await tx.insert(overflow).values(overflowRows);

    return planRow.id;
  });
}

/** Commit a draft: mark it committed, supersede every other live plan for its date. */
export async function commitPlan(planId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await tx.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!target) throw new Error("Plan not found.");
    if (target.status === "committed") return;

    await tx
      .update(plans)
      .set({ status: "superseded" })
      .where(and(eq(plans.date, target.date), inArray(plans.status, ["draft", "committed"])));

    await tx.update(plans).set({ status: "committed" }).where(eq(plans.id, planId));
  });
}

/** Throw away a draft plan entirely. */
export async function discardDraft(planId: string): Promise<void> {
  await db
    .delete(plans)
    .where(and(eq(plans.id, planId), eq(plans.status, "draft")));
}
