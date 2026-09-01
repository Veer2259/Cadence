/**
 * lib/goals.ts — the layer above the daily loop.
 *
 * A bucket carries the outcome ("what done looks like") and weekly_targets
 * carry the week-by-week slices of it. Everything here is DESCRIPTIVE: it
 * reports where things stand and how far off they are, and never tells the
 * person what to do about it (SPEC's rule for the weekly review).
 *
 * Every link is optional. A task with no weekly target, or a bucket with no
 * outcome, behaves exactly as it did before this layer existed.
 */

import "server-only";
import { and, asc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buckets, weeklyTargets, tasks, timeLog } from "@/db/schema";
import { istToday, addIstDays } from "@/lib/time";

/** The IST Monday on or before a date. */
export function weekStartOf(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00+05:30`).getUTCDay(); // 0 Sun..6 Sat
  return addIstDays(dateStr, -(dow === 0 ? 6 : dow - 1));
}

export type WeeklyTargetView = {
  id: string;
  bucketId: string;
  bucketName: string;
  weekStart: string;
  description: string;
  targetHours: number | null;
  status: "planned" | "hit" | "missed" | "partial" | "dropped";
  reviewNote: string | null;
  /** tasks linked to this target */
  totalTasks: number;
  doneTasks: number;
  /** hours actually logged against the target's bucket that week */
  actualHours: number;
};

export async function weeklyTargetsFor(weekStart: string): Promise<WeeklyTargetView[]> {
  const weekEnd = addIstDays(weekStart, 6);

  const rows = await db
    .select({
      id: weeklyTargets.id,
      bucketId: weeklyTargets.bucketId,
      bucketName: buckets.name,
      weekStart: weeklyTargets.weekStart,
      description: weeklyTargets.description,
      targetHours: weeklyTargets.targetHours,
      status: weeklyTargets.status,
      reviewNote: weeklyTargets.reviewNote,
    })
    .from(weeklyTargets)
    .innerJoin(buckets, eq(weeklyTargets.bucketId, buckets.id))
    .where(eq(weeklyTargets.weekStart, weekStart))
    .orderBy(asc(buckets.name));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      weeklyTargetId: tasks.weeklyTargetId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.weeklyTargetId, rows.map((r) => r.id)),
        sql`${tasks.status} <> 'dropped'`,
      ),
    )
    .groupBy(tasks.weeklyTargetId);
  const byTarget = new Map(counts.map((c) => [c.weeklyTargetId as string, c]));

  const logged = await db
    .select({ bucketId: timeLog.bucketId, durationMin: timeLog.durationMin })
    .from(timeLog)
    .where(and(gte(timeLog.date, weekStart), lte(timeLog.date, weekEnd)));
  const minsByBucket = new Map<string, number>();
  for (const l of logged) {
    if (!l.bucketId) continue;
    minsByBucket.set(l.bucketId, (minsByBucket.get(l.bucketId) ?? 0) + l.durationMin);
  }

  return rows.map((r) => {
    const c = byTarget.get(r.id);
    return {
      id: r.id,
      bucketId: r.bucketId,
      bucketName: r.bucketName,
      weekStart: r.weekStart,
      description: r.description,
      targetHours: r.targetHours == null ? null : Number(r.targetHours),
      status: r.status,
      reviewNote: r.reviewNote,
      totalTasks: c?.total ?? 0,
      doneTasks: c?.done ?? 0,
      actualHours: Math.round(((minsByBucket.get(r.bucketId) ?? 0) / 60) * 10) / 10,
    };
  });
}

export type BucketGoal = {
  id: string;
  name: string;
  outcome: string | null;
  outcomeTargetDate: string | null;
  status: "active" | "achieved" | "abandoned";
  weeklyTargetMin: number | null;
  /** whole weeks from this week's Monday to the target date; negative = past */
  weeksLeft: number | null;
};

export async function bucketGoals(todayStr = istToday()): Promise<BucketGoal[]> {
  const rows = await db
    .select({
      id: buckets.id,
      name: buckets.name,
      outcome: buckets.outcome,
      outcomeTargetDate: buckets.outcomeTargetDate,
      status: buckets.status,
      weeklyTargetMin: buckets.weeklyTargetMin,
      active: buckets.active,
    })
    .from(buckets)
    .orderBy(asc(buckets.name));

  const thisMonday = weekStartOf(todayStr);
  return rows
    .filter((r) => r.active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      outcome: r.outcome,
      outcomeTargetDate: r.outcomeTargetDate,
      status: r.status,
      weeklyTargetMin: r.weeklyTargetMin,
      weeksLeft: r.outcomeTargetDate
        ? Math.round(
            (Date.parse(`${weekStartOf(r.outcomeTargetDate)}T00:00:00Z`) -
              Date.parse(`${thisMonday}T00:00:00Z`)) /
              (7 * 86_400_000),
          )
        : null,
    }));
}
