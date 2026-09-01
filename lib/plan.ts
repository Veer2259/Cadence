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
import {
  plans,
  blocks,
  overflow,
  commitments,
  type Plan,
  type Block,
  type OverflowRow,
} from "@/db/schema";
import {
  istDayInstant,
  istMinutesOfDay,
  istTimeString,
  istWeekdayKeyForDate,
  minutesToHm,
  windowsForWeekday,
} from "@/lib/time";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import {
  checkDayGeometry,
  type GeometryContext,
  type GeoBlock,
} from "@/lib/plan-geometry";
import type { ComposeInput } from "@/lib/ai/compose-types";
import type { PlanBlock, PlanResult } from "@/lib/ai/schemas";

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
  const habitIdByName = new Map(
    input.habitsDue.map((h) => [h.name.trim().toLowerCase(), h.id]),
  );

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
      const habitId =
        b.kind === "habit"
          ? (habitIdByName.get(b.title.trim().toLowerCase()) ?? null)
          : null;
      return {
        planId: planRow.id,
        taskId: isTask ? b.taskId! : null,
        habitId,
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

/* ------------------------------------------------------------------ */
/*  Manual block edits — drag-to-adjust + the assistant's adjust_block */
/* ------------------------------------------------------------------ */

/** Snap a minute value to the nearest 5, clamped to a single day. */
function snap5(min: number): number {
  return Math.min(1440, Math.max(0, Math.round(min / 5) * 5));
}

/** A block row rendered back into the model-output shape for output_snapshot. */
function blockRowToPlanBlock(b: Block): PlanBlock {
  return {
    taskId: b.taskId ?? null,
    title: b.title,
    start: istTimeString(b.startAt),
    end: istTimeString(b.endAt),
    kind: b.kind,
    category: b.category,
    estimateMin: b.estimateMin,
    reason: b.reason,
  };
}

/** The positional context for `checkDayGeometry` on a given IST date. */
export async function buildGeometryContext(
  dateStr: string,
): Promise<GeometryContext> {
  const profile = await getOrCreateDayProfile();
  const weekday = istWeekdayKeyForDate(dateStr);

  const dayStart = istDayInstant(dateStr, "00:00");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayCommitments = (await db.select().from(commitments)).filter(
    (c) => c.startAt < dayEnd && c.endAt > dayStart,
  );

  return {
    workWindows: windowsForWeekday(profile.workWindows, weekday),
    commitments: dayCommitments.map((c) => ({
      start: istTimeString(c.startAt),
      end: istTimeString(c.endAt),
    })),
    protectedBlocks: profile.protectedBlocks,
    dailyCapMin: profile.dailyCapMin,
  };
}

function blocksToGeo(rows: Block[]): GeoBlock[] {
  return rows.map((b) => ({
    startMin: istMinutesOfDay(b.startAt),
    endMin: (() => {
      const e = istMinutesOfDay(b.endAt);
      return e <= istMinutesOfDay(b.startAt) ? 1440 : e;
    })(),
    kind: b.kind,
    title: b.title,
  }));
}

export type BlockEditResult =
  | { ok: true; violations: string[] }
  | { ok: false; error: string };

/**
 * Move / resize one block on whatever plan is live for `dateStr` (a draft takes
 * precedence over its committed parent, matching what the ribbon shows). The
 * edit is applied in place — no status change, no supersede, no model call —
 * so it works on a committed plan too. Nothing else moves; conflicts introduced
 * by the edit are returned, not fixed.
 */
export async function applyBlockAdjustment(args: {
  dateStr: string;
  blockId: string;
  startMin: number;
  endMin: number;
}): Promise<BlockEditResult> {
  const { dateStr, blockId } = args;
  const live = await getLivePlan(dateStr);
  if (!live) return { ok: false, error: "There is no plan to adjust today." };
  if (!live.blocks.some((b) => b.id === blockId)) {
    return { ok: false, error: "That block is not on today's plan." };
  }

  const startMin = snap5(args.startMin);
  let endMin = snap5(args.endMin);
  if (endMin <= startMin) endMin = Math.min(1440, startMin + 5);

  await db
    .update(blocks)
    .set({
      startAt: istDayInstant(dateStr, minutesToHm(startMin)),
      endAt: istDayInstant(dateStr, minutesToHm(endMin)),
    })
    .where(eq(blocks.id, blockId));

  return finishBlockEdit(dateStr, live.plan.id);
}

export type HabitPlacement = BlockEditResult & { moved?: boolean };

/**
 * Put a habit on the live plan at an explicit time. Used by the chat rail's
 * `place_habit_today` when the person says "football tonight".
 *
 * If the habit is ALREADY on today's plan (the planner scheduled it, or they
 * placed it earlier), its block is moved rather than a second one added —
 * "football tonight" means the one football, at a different time. Otherwise a
 * new block is inserted. Either way nothing else moves, and any conflict the
 * placement creates is reported, not fixed.
 */
export async function placeHabitBlock(args: {
  dateStr: string;
  habitId: string;
  title: string;
  durationMin: number;
  startMin: number;
  endMin: number;
  reason: string;
}): Promise<HabitPlacement> {
  const { dateStr, habitId, title, reason } = args;
  const live = await getLivePlan(dateStr);
  if (!live) {
    return {
      ok: false,
      error: "There is no plan for today yet — build one first, then place the habit.",
    };
  }

  const startMin = snap5(args.startMin);
  const endMin = Math.max(startMin + 5, snap5(args.endMin));
  const startAt = istDayInstant(dateStr, minutesToHm(startMin));
  const endAt = istDayInstant(dateStr, minutesToHm(endMin));

  // Already on the plan? Move that block instead of duplicating the habit.
  const existing = live.blocks.find(
    (b) =>
      b.kind === "habit" &&
      (b.habitId === habitId ||
        b.title.trim().toLowerCase() === title.trim().toLowerCase()),
  );

  if (existing) {
    // Never move a block that already happened.
    if (existing.status === "done" || existing.status === "partial") {
      return {
        ok: false,
        error: `"${title}" is already marked ${existing.status} today — leaving it where it is.`,
      };
    }
    await db
      .update(blocks)
      .set({ startAt, endAt, habitId, estimateMin: endMin - startMin })
      .where(eq(blocks.id, existing.id));
    return { ...(await finishBlockEdit(dateStr, live.plan.id)), moved: true };
  }

  await db.insert(blocks).values({
    planId: live.plan.id,
    taskId: null,
    habitId,
    startAt,
    endAt,
    kind: "habit",
    title,
    category: "personal",
    reason: reason.slice(0, 90),
    estimateMin: endMin - startMin,
    rawEstimateMin: args.durationMin,
    status: "planned",
  });

  return { ...(await finishBlockEdit(dateStr, live.plan.id)), moved: false };
}

/** Remove one block from the live plan (the assistant's confirmed `drop`). */
export async function dropPlanBlock(args: {
  dateStr: string;
  blockId: string;
}): Promise<BlockEditResult> {
  const { dateStr, blockId } = args;
  const live = await getLivePlan(dateStr);
  if (!live) return { ok: false, error: "There is no plan to adjust today." };
  if (!live.blocks.some((b) => b.id === blockId)) {
    return { ok: false, error: "That block is not on today's plan." };
  }

  await db.delete(blocks).where(eq(blocks.id, blockId));
  return finishBlockEdit(dateStr, live.plan.id);
}

/** Re-read the plan's blocks, re-run the geometry checks, keep the snapshot honest. */
async function finishBlockEdit(
  dateStr: string,
  planId: string,
): Promise<BlockEditResult> {
  const rows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.planId, planId))
    .orderBy(asc(blocks.startAt));

  const violations = checkDayGeometry(
    blocksToGeo(rows),
    await buildGeometryContext(dateStr),
  );

  // Keep output_snapshot.blocks consistent with the rows so a later
  // rebalance / audit view does not show stale times.
  const planRow = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
  const snap = (planRow?.outputSnapshot ?? null) as PlanResult | null;
  if (snap) {
    await db
      .update(plans)
      .set({ outputSnapshot: { ...snap, blocks: rows.map(blockRowToPlanBlock) } })
      .where(eq(plans.id, planId));
  }

  return { ok: true, violations };
}
