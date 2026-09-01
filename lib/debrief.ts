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
  habits,
  timeLog,
  calibration,
  energyLog,
  type Block,
  type Plan,
} from "@/db/schema";
import { istMinutesOfDay } from "@/lib/time";
import type { EnergyLevel } from "@/lib/energy";
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

/** Bucket id per habit — habit blocks carry their bucket on the habit, not a task. */
async function habitBucketMap(habitIds: string[]): Promise<Map<string, string | null>> {
  if (habitIds.length === 0) return new Map();
  const rows = await db
    .select({ id: habits.id, bucketId: habits.bucketId })
    .from(habits)
    .where(inArray(habits.id, habitIds));
  return new Map(rows.map((r) => [r.id, r.bucketId]));
}

/**
 * The energy sample nearest a moment, for the day being debriefed. Denormalised
 * onto each time_log row so "does my accuracy vary by energy" is one query
 * rather than a windowed join nobody will write.
 */
function nearestEnergy(
  samples: { minuteOfDay: number; level: EnergyLevel }[],
  at: Date,
): EnergyLevel | null {
  if (samples.length === 0) return null;
  const target = istMinutesOfDay(at);
  let best = samples[0];
  let bestGap = Math.abs(best.minuteOfDay - target);
  for (const s of samples.slice(1)) {
    const gap = Math.abs(s.minuteOfDay - target);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  // more than 3h away is not evidence about this block
  return bestGap <= 180 ? best.level : null;
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

  const bucketByHabit = await habitBucketMap([
    ...new Set(blockRows.filter((b) => b.habitId).map((b) => b.habitId as string)),
  ]);
  const energySamples = (
    await db
      .select({ minuteOfDay: energyLog.minuteOfDay, level: energyLog.level })
      .from(energyLog)
      .where(eq(energyLog.date, plan.date))
  ).map((r) => ({ minuteOfDay: r.minuteOfDay, level: r.level as EnergyLevel }));
  const energyForBlock = (at: Date) => nearestEnergy(energySamples, at);

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
        .set({
          status: r.status,
          actualMin: r.actualMin,
          // keep the live log-as-you-go timestamp if there is one; otherwise
          // this debrief is the moment we learned about it
          loggedAt: r.block.loggedAt ?? now,
        })
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
        const actualMin = r.actualMin as number;
        loggedMin += actualMin;
        // When the block was logged we know roughly when the work ENDED, so the
        // actual start is that minus its duration. Without a log we can only
        // fall back to the planned time — and we say so by leaving them equal.
        const endedAt = r.block.loggedAt ?? null;
        const actualStart = endedAt
          ? new Date(endedAt.getTime() - actualMin * 60_000)
          : r.block.startAt;
        return {
          date: plan.date,
          startAt: actualStart,
          endAt: new Date(actualStart.getTime() + actualMin * 60_000),
          plannedStartAt: r.block.startAt,
          durationMin: actualMin,
          rawEstimateMin: r.block.rawEstimateMin,
          // habits carry their own bucket; before this they logged bucketId null
          // and their hours vanished from every per-bucket total
          bucketId: r.block.taskId
            ? (bucketByTask.get(r.block.taskId) ?? null)
            : r.block.habitId
              ? (bucketByHabit.get(r.block.habitId) ?? null)
              : null,
          taskId: r.block.taskId,
          kind: r.block.kind,
          energyLevel: energyForBlock(actualStart),
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
