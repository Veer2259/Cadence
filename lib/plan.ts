/**
 * lib/plan.ts — persist and read time-blocked plans.
 *
 * At most one committed plan per date, and at most one draft. A committed day
 * is edited in place — there is no second plan that supersedes it. A rebalance
 * draft used to be allowed to coexist
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
import { assertTasksAccountedFor, type TaskRef } from "@/lib/plan-invariant";
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

/** The committed, not-yet-debriefed plan for a date. */
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
 *
 * Refuses if a committed plan already exists for the date. There is no longer a
 * second path that supersedes one: a committed day is edited IN PLACE, by drag
 * or by the assistant, which is what "committed plans are edited in place"
 * already meant for every other kind of change.
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

    const committed = await tx.query.plans.findFirst({
      where: and(eq(plans.date, dateStr), eq(plans.status, "committed")),
    });
    if (committed) {
      throw new Error(
        "A committed plan already exists for this date. Ask Cadence to change it, " +
          "or drag the blocks — a committed day is edited in place.",
      );
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

    const allRows = newRows;
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

    // THE INVARIANT — inside the transaction, so a plan that would lose a task
    // is rolled back rather than saved. Loud beats silent: with twenty tasks in
    // flight, a task that vanishes without an overflow row is invisible.
    assertTasksAccountedFor({
      inputTasks: input.tasks.map((t): TaskRef => ({ id: t.id, title: t.title })),
      blockTaskIds: allRows.map((r) => r.taskId ?? null),
      overflowTaskIds: overflowRows.map((r) => r.taskId),
    });

    return planRow.id;
  });
}

/**
 * Re-check the invariant against what is actually in the database for a plan.
 * Used after edit paths, which mutate rows outside saveDraftPlan.
 */
export async function auditPlanAccounting(planId: string): Promise<TaskRef[]> {
  const planRow = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
  if (!planRow) return [];
  const snap = (planRow.inputSnapshot ?? null) as { tasks?: TaskRef[] } | null;
  const inputTasks = (snap?.tasks ?? []).map((t) => ({ id: t.id, title: t.title }));
  if (inputTasks.length === 0) return [];

  const [bl, ov] = await Promise.all([
    db.select({ taskId: blocks.taskId }).from(blocks).where(eq(blocks.planId, planId)),
    db.select({ taskId: overflow.taskId }).from(overflow).where(eq(overflow.planId, planId)),
  ]);
  const { findUnaccountedTasks } = await import("@/lib/plan-invariant");
  return findUnaccountedTasks({
    inputTasks,
    blockTaskIds: bl.map((b) => b.taskId),
    overflowTaskIds: ov.map((o) => o.taskId),
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
    category: "shallow",
    reason: reason.slice(0, 90),
    estimateMin: endMin - startMin,
    rawEstimateMin: args.durationMin,
    status: "planned",
  });

  return { ...(await finishBlockEdit(dateStr, live.plan.id)), moved: false };
}

/**
 * Remove one block from the live plan (the assistant's confirmed `drop`, or a
 * displacement).
 *
 * A task block does NOT simply disappear: dropping it writes an overflow row so
 * the task still has a trace and a reason. This is the path that once lost a
 * task silently — with twenty in flight, nobody would have noticed.
 */
export async function dropPlanBlock(args: {
  dateStr: string;
  blockId: string;
  reason?: string;
}): Promise<BlockEditResult & { deferredTask?: string }> {
  const { dateStr, blockId } = args;
  const live = await getLivePlan(dateStr);
  if (!live) return { ok: false, error: "There is no plan to adjust today." };
  const block = live.blocks.find((b) => b.id === blockId);
  if (!block) return { ok: false, error: "That block is not on today's plan." };

  const reason =
    args.reason?.trim() ||
    "Removed from the plan by hand; nothing was scheduled in its place.";

  await db.transaction(async (tx) => {
    await tx.delete(blocks).where(eq(blocks.id, blockId));

    // A task leaving the plan gets an overflow row. Habits, breaks and fixed
    // blocks have no task to account for, so they need none.
    if (block.taskId) {
      const stillScheduled = live.blocks.some(
        (b) => b.id !== blockId && b.taskId === block.taskId,
      );
      const alreadyDeferred = live.overflow.some((o) => o.taskId === block.taskId);
      if (!stillScheduled && !alreadyDeferred) {
        await tx.insert(overflow).values({
          planId: live.plan.id,
          taskId: block.taskId,
          reason,
          action: "defer",
          suggestion: "Carry it to another day, or shrink it to fit today.",
        });
      }
    }
  });

  const res = await finishBlockEdit(dateStr, live.plan.id);
  return { ...res, deferredTask: block.taskId ? block.title : undefined };
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
  // audit view does not show stale times.
  const planRow = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
  const snap = (planRow?.outputSnapshot ?? null) as PlanResult | null;
  if (snap) {
    await db
      .update(plans)
      .set({ outputSnapshot: { ...snap, blocks: rows.map(blockRowToPlanBlock) } })
      .where(eq(plans.id, planId));
  }

  const lost = await auditPlanAccounting(planId);
  if (lost.length) {
    // Not thrown: the edit already happened and the row is gone. Surfacing it
    // in the warnings is what makes it visible instead of silent.
    violations.push(
      ...lost.map(
        (t) => `"${t.title}" is no longer on the plan and has no overflow record`,
      ),
    );
  }

  return { ok: true, violations };
}

/* ------------------------------------------------------------------ */
/*  Log-as-you-go — mark a block done / partial / skipped mid-day      */
/* ------------------------------------------------------------------ */

export type BlockLogResult =
  | { ok: true; status: "planned" | "done" | "partial" | "skipped" }
  | { ok: false; error: string };

/**
 * Mark one block during the day, rather than only at debrief.
 *
 * `done` records the block's scheduled duration as the actual (it may differ
 * from the original estimate if the block was dragged), which is what debrief
 * then pre-fills and what calibration eventually samples. `partial` leaves
 * actual_min null on purpose — the debrief is where the real number is given.
 * `planned` clears the log again, so a mis-tap is undoable.
 */
export async function logBlockStatus(args: {
  dateStr: string;
  blockId: string;
  status: "planned" | "done" | "partial" | "skipped";
}): Promise<BlockLogResult> {
  const { dateStr, blockId, status } = args;
  const live = await getLivePlan(dateStr);
  if (!live) return { ok: false, error: "There is no plan today." };
  if (live.plan.debriefedAt) {
    return { ok: false, error: "This day is already closed out." };
  }
  const block = live.blocks.find((b) => b.id === blockId);
  if (!block) return { ok: false, error: "That block is not on today's plan." };

  const durationMin = Math.max(
    0,
    istMinutesOfDay(block.endAt) - istMinutesOfDay(block.startAt),
  );

  await db
    .update(blocks)
    .set({
      status,
      actualMin: status === "done" ? durationMin : null,
      // the only record of WHEN this actually happened — start_at/end_at are
      // the plan's intent and never move. Cleared when the log is undone.
      loggedAt: status === "planned" ? null : new Date(),
    })
    .where(eq(blocks.id, blockId));

  return { ok: true, status };
}
