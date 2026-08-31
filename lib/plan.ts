/**
 * lib/plan.ts — persist and read time-blocked plans.
 *
 * SPEC section 3: only one plan per date may be `draft` or `committed` at a time.
 * "Plan my day" replaces the current draft; committing supersedes any prior
 * committed plan for that date.
 */

import "server-only";
import { and, eq, inArray, asc } from "drizzle-orm";
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

/** The single draft-or-committed plan for an IST date, with its blocks + overflow. */
export async function getLivePlan(dateStr: string): Promise<LivePlan | null> {
  const row = await db.query.plans.findFirst({
    where: and(eq(plans.date, dateStr), inArray(plans.status, ["draft", "committed"])),
  });
  if (!row) return null;

  const [bl, ov] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.planId, row.id)).orderBy(asc(blocks.startAt)),
    db.select().from(overflow).where(eq(overflow.planId, row.id)),
  ]);
  return { plan: row, blocks: bl, overflow: ov };
}

/**
 * Write a fresh draft plan for `dateStr` from a compose result, replacing any
 * existing draft for that date. Throws if a committed plan already exists —
 * re-planning a committed day is the rebalance path (Phase 4).
 */
export async function saveDraftPlan(args: {
  dateStr: string;
  model: string;
  input: ComposeInput;
  plan: PlanResult;
}): Promise<string> {
  const { dateStr, model, input, plan } = args;
  const taskIds = new Set(input.tasks.map((t) => t.id));
  const rawByTask = new Map(input.tasks.map((t) => [t.id, t.rawEstimateMin]));

  return db.transaction(async (tx) => {
    const existing = await tx.query.plans.findFirst({
      where: and(eq(plans.date, dateStr), inArray(plans.status, ["draft", "committed"])),
    });
    if (existing?.status === "committed") {
      throw new Error(
        "A committed plan already exists for this date. Rebalance it instead of re-planning.",
      );
    }
    if (existing) {
      await tx.delete(plans).where(eq(plans.id, existing.id)); // cascades to blocks / overflow
    }

    const [planRow] = await tx
      .insert(plans)
      .values({
        date: dateStr,
        status: "draft",
        model,
        inputSnapshot: input,
        outputSnapshot: plan,
      })
      .returning();

    const blockRows = plan.blocks.map((b) => {
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
    if (blockRows.length) await tx.insert(blocks).values(blockRows);

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

/** Commit a draft: mark it committed, supersede any other live plan for its date. */
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
