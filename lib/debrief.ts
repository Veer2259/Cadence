/**
 * lib/debrief.ts — close out a day: write actuals, log time, update calibration,
 * carry unfinished tasks forward. SPEC section 6.4 + section 4.
 */

import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  plans,
  blocks,
  tasks,
  timeLog,
  calibration,
  type Block,
  type Plan,
} from "@/db/schema";
import { nextRatio, sampleFor } from "@/lib/calibration";
import { summariseDebrief, type DebriefDigest } from "@/lib/ai/modes/debrief";

export type BlockStatus = "done" | "partial" | "skipped";

export type DebriefEntry = {
  blockId: string;
  status: BlockStatus;
  actualMin: number | null;
};

/* ------------------------------------------------------------------ */
/*  Which plan is up for debrief                                       */
/* ------------------------------------------------------------------ */

/** The most recent committed, not-yet-debriefed plan (optionally for one date). */
export async function getPlanToDebrief(dateStr?: string): Promise<
  { plan: Plan; blockRows: Block[] } | null
> {
  const plan = await db.query.plans.findFirst({
    where: and(
      eq(plans.status, "committed"),
      isNull(plans.debriefedAt),
      dateStr ? eq(plans.date, dateStr) : undefined,
    ),
    orderBy: [desc(plans.date)],
  });
  if (!plan) return null;

  const blockRows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.planId, plan.id))
    .orderBy(blocks.startAt);

  return { plan, blockRows };
}

/* ------------------------------------------------------------------ */
/*  Submit                                                            */
/* ------------------------------------------------------------------ */

export type DebriefResult = {
  plannedMin: number;
  loggedMin: number;
  carriedOver: number;
  tasksDone: number;
  calibrationTouched: string[];
  summary: string;
};

/** Look up bucket id per task for the given block set. */
async function taskBucketMap(taskIds: string[]): Promise<Map<string, string | null>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ id: tasks.id, bucketId: tasks.bucketId })
    .from(tasks)
    .where(inArray(tasks.id, taskIds));
  return new Map(rows.map((r) => [r.id, r.bucketId]));
}

export async function submitDebrief(
  planId: string,
  entries: DebriefEntry[],
): Promise<DebriefResult> {
  const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
  if (!plan) throw new Error("Plan not found.");
  if (plan.status !== "committed") throw new Error("Only a committed plan can be debriefed.");
  if (plan.debriefedAt) throw new Error("This day has already been debriefed.");

  const blockRows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.planId, planId))
    .orderBy(blocks.startAt);

  const entryByBlock = new Map(entries.map((e) => [e.blockId, e]));

  // --- resolve the final state of every block ---
  type Resolved = { block: Block; status: BlockStatus; actualMin: number | null };
  const resolved: Resolved[] = blockRows.map((block) => {
    if (block.kind === "break") {
      return { block, status: "done" as const, actualMin: block.estimateMin };
    }
    const e = entryByBlock.get(block.id);
    if (!e) return { block, status: "done" as const, actualMin: block.estimateMin };

    if (e.status === "skipped") return { block, status: "skipped" as const, actualMin: null };

    let actual = e.actualMin ?? block.estimateMin;
    actual = Math.max(0, Math.min(1440, Math.round(actual)));
    return { block, status: e.status, actualMin: actual };
  });

  const taskIds = [
    ...new Set(blockRows.filter((b) => b.taskId).map((b) => b.taskId as string)),
  ];
  const bucketByTask = await taskBucketMap(taskIds);

  // --- calibration: seed the running map from existing rows ---
  const calRows = await db.select().from(calibration);
  const running = new Map<string, { ratio: number; sampleN: number }>(
    calRows.map((r) => [`${r.scope}:${r.key}`, { ratio: Number(r.ratio), sampleN: r.sampleN }]),
  );
  const touched = new Set<string>();

  function record(scope: "category" | "bucket", key: string, sample: number) {
    const k = `${scope}:${key}`;
    const cur = running.get(k) ?? { ratio: 1, sampleN: 0 };
    running.set(k, { ratio: nextRatio(sample, cur.ratio), sampleN: cur.sampleN + 1 });
    touched.add(k);
  }

  for (const r of resolved) {
    if (r.block.kind !== "task") continue;
    if (r.status === "skipped" || r.actualMin == null) continue;
    const sample = sampleFor(r.actualMin, r.block.rawEstimateMin);
    if (sample == null) continue;
    record("category", r.block.category, sample);
    const bucketId = r.block.taskId ? bucketByTask.get(r.block.taskId) : null;
    if (bucketId) record("bucket", bucketId, sample);
  }

  // --- carry-over: per task, done only if every one of its blocks is done ---
  const blocksByTask = new Map<string, Resolved[]>();
  for (const r of resolved) {
    if (r.block.kind !== "task" || !r.block.taskId) continue;
    const arr = blocksByTask.get(r.block.taskId) ?? [];
    arr.push(r);
    blocksByTask.set(r.block.taskId, arr);
  }
  const doneTaskIds: string[] = [];
  const carryTaskIds: string[] = [];
  for (const [taskId, rs] of blocksByTask) {
    if (rs.every((r) => r.status === "done")) doneTaskIds.push(taskId);
    else carryTaskIds.push(taskId);
  }

  const now = new Date();
  let loggedMin = 0;
  const plannedMin = blockRows.reduce((n, b) => n + b.estimateMin, 0);

  await db.transaction(async (tx) => {
    // 1. block actuals
    for (const r of resolved) {
      await tx
        .update(blocks)
        .set({ status: r.status, actualMin: r.actualMin })
        .where(eq(blocks.id, r.block.id));
    }

    // 2. time_log — real activity only (task / habit / fixed), not breaks
    const logRows = resolved
      .filter(
        (r) =>
          r.status !== "skipped" &&
          r.actualMin != null &&
          r.actualMin > 0 &&
          r.block.kind !== "break",
      )
      .map((r) => {
        loggedMin += r.actualMin as number;
        return {
          date: plan.date,
          startAt: r.block.startAt,
          endAt: new Date(r.block.startAt.getTime() + (r.actualMin as number) * 60_000),
          durationMin: r.actualMin as number,
          bucketId: r.block.taskId ? (bucketByTask.get(r.block.taskId) ?? null) : null,
          taskId: r.block.taskId,
          category: r.block.category,
          planned: true,
        };
      });
    if (logRows.length) await tx.insert(timeLog).values(logRows);

    // 3. calibration upserts
    for (const k of touched) {
      const [scope, key] = k.split(/:(.+)/) as ["category" | "bucket", string];
      const v = running.get(k)!;
      await tx
        .insert(calibration)
        .values({ scope, key, ratio: v.ratio.toFixed(2), sampleN: v.sampleN })
        .onConflictDoUpdate({
          target: [calibration.scope, calibration.key],
          set: { ratio: v.ratio.toFixed(2), sampleN: v.sampleN, updatedAt: now },
        });
    }

    // 4. carry-over
    if (doneTaskIds.length) {
      await tx
        .update(tasks)
        .set({ status: "done", completedAt: now })
        .where(inArray(tasks.id, doneTaskIds));
    }
    if (carryTaskIds.length) {
      await tx
        .update(tasks)
        .set({ deferCount: sql`${tasks.deferCount} + 1` })
        .where(inArray(tasks.id, carryTaskIds));
    }

    // 5. mark debriefed
    await tx.update(plans).set({ debriefedAt: now }).where(eq(plans.id, planId));
  });

  // --- digest + summary (model call, outside the transaction) ---
  const catAgg = new Map<string, { planned: number; logged: number }>();
  for (const r of resolved) {
    if (r.block.kind === "break") continue;
    const c = catAgg.get(r.block.category) ?? { planned: 0, logged: 0 };
    c.planned += r.block.estimateMin;
    c.logged += r.status === "skipped" ? 0 : (r.actualMin ?? 0);
    catAgg.set(r.block.category, c);
  }
  const digest: DebriefDigest = {
    date: plan.date,
    plannedMin,
    loggedMin,
    byCategory: [...catAgg.entries()].map(([category, v]) => ({
      category,
      plannedMin: v.planned,
      loggedMin: v.logged,
      deltaMin: v.logged - v.planned,
    })),
    skipped: resolved.filter((r) => r.status === "skipped").map((r) => r.block.title),
    partial: resolved.filter((r) => r.status === "partial").map((r) => r.block.title),
    carriedOver: carryTaskIds.length,
  };

  const summary = await summariseDebrief(digest);
  await db.update(plans).set({ debriefSummary: summary }).where(eq(plans.id, planId));

  return {
    plannedMin,
    loggedMin,
    carriedOver: carryTaskIds.length,
    tasksDone: doneTaskIds.length,
    calibrationTouched: [...touched],
    summary,
  };
}
