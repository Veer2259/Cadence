/**
 * lib/capacity.ts — the evidence breakdown uses to push back.
 *
 * "Three weeks" is a claim about capacity. This assembles what the app already
 * knows about the person's real capacity so the claim can be checked against
 * it with numbers rather than vibes: hours actually logged per bucket per week,
 * how far their estimates run over, and how often work in that bucket gets
 * deferred.
 *
 * Descriptive only. It reports; the mode decides what to say about it.
 */

import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { buckets, tasks, timeLog, calibration } from "@/db/schema";
import { istToday, addIstDays } from "@/lib/time";
import { weekStartOf } from "@/lib/goals";

export type BucketCapacity = {
  bucketId: string;
  bucket: string;
  /** mean hours per week actually logged, over the window below */
  meanHoursPerWeek: number;
  /** best and worst week seen, so a mean of 4 does not hide a 0 and an 8 */
  minHoursInAWeek: number;
  maxHoursInAWeek: number;
  weeksObserved: number;
  /** the stated weekly intent, if any */
  /** active tasks in this bucket that have been carried at least once */
  deferredTasks: number;
  worstDeferCount: number;
};

export type CapacityEvidence = {
  fromDate: string;
  toDate: string;
  weeks: number;
  buckets: BucketCapacity[];
  /** calibration ratios by category — how far estimates run over in practice */
  calibration: { category: string; ratio: number; sampleN: number }[];
  /** true when there is barely any history; the mode must say so rather than bluff */
  thin: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Assemble capacity evidence over the last `weeks` complete weeks.
 * Defaults to 8 — long enough to show a pattern, short enough to reflect now.
 */
export async function capacityEvidence(
  weeks = 8,
  todayStr = istToday(),
): Promise<CapacityEvidence> {
  const thisMonday = weekStartOf(todayStr);
  const fromDate = addIstDays(thisMonday, -7 * weeks);
  const toDate = addIstDays(thisMonday, -1); // through last Sunday

  const bucketRows = await db
    .select({
      id: buckets.id,
      name: buckets.name,
      active: buckets.active,
    })
    .from(buckets);

  const logged = await db
    .select({
      bucketId: timeLog.bucketId,
      date: timeLog.date,
      durationMin: timeLog.durationMin,
    })
    .from(timeLog)
    .where(and(gte(timeLog.date, fromDate), lte(timeLog.date, toDate)));

  // minutes per (bucket, week)
  const perBucketWeek = new Map<string, Map<string, number>>();
  for (const l of logged) {
    if (!l.bucketId) continue;
    const wk = weekStartOf(l.date);
    const byWeek = perBucketWeek.get(l.bucketId) ?? new Map<string, number>();
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + l.durationMin);
    perBucketWeek.set(l.bucketId, byWeek);
  }

  const deferRows = await db
    .select({
      bucketId: tasks.bucketId,
      n: sql<number>`count(*)::int`,
      worst: sql<number>`max(${tasks.deferCount})::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.status, "active"), sql`${tasks.deferCount} > 0`))
    .groupBy(tasks.bucketId);
  const deferByBucket = new Map(deferRows.map((d) => [d.bucketId as string, d]));

  const bucketOut: BucketCapacity[] = bucketRows
    .filter((b) => b.active)
    .map((b) => {
      const byWeek = perBucketWeek.get(b.id);
      // Weeks with no logged time are real zeros, not missing data — a bucket
      // that got nothing for three weeks HAS a capacity of zero for those weeks.
      const values: number[] = [];
      for (let i = 0; i < weeks; i++) {
        const wk = addIstDays(thisMonday, -7 * (weeks - i));
        values.push((byWeek?.get(wk) ?? 0) / 60);
      }
      const total = values.reduce((n, v) => n + v, 0);
      const d = deferByBucket.get(b.id);
      return {
        bucketId: b.id,
        bucket: b.name,
        meanHoursPerWeek: round1(total / weeks),
        minHoursInAWeek: round1(Math.min(...values)),
        maxHoursInAWeek: round1(Math.max(...values)),
        weeksObserved: weeks,
        deferredTasks: d?.n ?? 0,
        worstDeferCount: d?.worst ?? 0,
      };
    });

  const calRows = await db
    .select()
    .from(calibration)

  const totalLoggedMin = logged.reduce((n, l) => n + l.durationMin, 0);

  return {
    fromDate,
    toDate,
    weeks,
    buckets: bucketOut,
    calibration: calRows.map((r) => ({
      category: r.key,
      ratio: Number(r.ratio),
      sampleN: r.sampleN,
    })),
    // Under ~5h logged across the whole window there is nothing honest to say
    // about capacity, and the mode is told to admit that instead of inventing.
    thin: totalLoggedMin < 300,
  };
}
