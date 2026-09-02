/**
 * lib/review.ts — the weekly review numbers (SPEC section 6.5 / screen 10).
 * Strictly descriptive: aggregates, no commentary.
 */

import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { blocks, plans, timeLog, calibration, tasks, buckets } from "@/db/schema";
import { istDateString } from "@/lib/time";
import { loadEnergySamples } from "@/lib/energy-db";
import { bucketByHour, type HourBucket } from "@/lib/energy";

export type AccuracyPoint = { date: string; ratio: number; blocks: number };
export type BucketHours = { bucket: string; hours7: number; hours30: number };
export type CategoryRatio = { category: string; ratio: number; sampleN: number };
export type DeferRow = { title: string; deferCount: number; status: string };

export type ReviewData = {
  accuracy: AccuracyPoint[];
  buckets: BucketHours[];
  categories: CategoryRatio[];
  deferLeaderboard: DeferRow[];
  /** mean energy per hour-of-day over the last 30 days */
  energyByHour: HourBucket[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function computeReview(now = new Date()): Promise<ReviewData> {
  const dateStr = (d: Date) => istDateString(d);
  const cut7 = dateStr(new Date(now.getTime() - 7 * 86_400_000));
  const cut30 = dateStr(new Date(now.getTime() - 30 * 86_400_000));

  // --- accuracy over time: per debriefed plan, sum(actual)/sum(raw_estimate) ---
  const accRows = await db
    .select({
      date: plans.date,
      actual: sql<number>`coalesce(sum(${blocks.actualMin}), 0)::int`,
      raw: sql<number>`coalesce(sum(${blocks.rawEstimateMin}), 0)::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(blocks)
    .innerJoin(plans, eq(plans.id, blocks.planId))
    .where(
      and(
        isNotNull(plans.debriefedAt),
        eq(blocks.kind, "task"),
        isNotNull(blocks.actualMin),
        gte(blocks.rawEstimateMin, 15),
      ),
    )
    .groupBy(plans.date)
    .orderBy(plans.date);

  const accuracy: AccuracyPoint[] = accRows
    .filter((r) => r.raw > 0)
    .map((r) => ({ date: r.date, ratio: round2(r.actual / r.raw), blocks: r.n }));

  // --- hours per bucket, 7d and 30d ---
  const bucketRows = await db.select({ id: buckets.id, name: buckets.name }).from(buckets);
  const bucketName = new Map(bucketRows.map((b) => [b.id, b.name]));

  const logRows = await db
    .select({ bucketId: timeLog.bucketId, durationMin: timeLog.durationMin, date: timeLog.date })
    .from(timeLog)
    .where(gte(timeLog.date, cut30));

  const byBucket = new Map<string, { h7: number; h30: number }>();
  for (const r of logRows) {
    const name = r.bucketId ? (bucketName.get(r.bucketId) ?? "?") : "(none)";
    const cur = byBucket.get(name) ?? { h7: 0, h30: 0 };
    cur.h30 += r.durationMin / 60;
    if (r.date >= cut7) cur.h7 += r.durationMin / 60;
    byBucket.set(name, cur);
  }
  const bucketsOut: BucketHours[] = [...byBucket.entries()]
    .map(([bucket, v]) => ({ bucket, hours7: round2(v.h7), hours30: round2(v.h30) }))
    .sort((a, b) => b.hours30 - a.hours30);

  // --- per-category calibration ---
  const catRows = await db
    .select()
    .from(calibration)
    .where(eq(calibration.scope, "category"))
    .orderBy(calibration.key);
  const categories: CategoryRatio[] = catRows.map((r) => ({
    category: r.key,
    ratio: round2(Number(r.ratio)),
    sampleN: r.sampleN,
  }));

  // --- defer leaderboard ---
  const deferRows = await db
    .select({ title: tasks.title, deferCount: tasks.deferCount, status: tasks.status })
    .from(tasks)
    .where(sql`${tasks.deferCount} > 0`)
    .orderBy(desc(tasks.deferCount))
    .limit(10);

  // --- energy ---
  const energySamples = await loadEnergySamples(30, now);
  const energyByHour = bucketByHour(energySamples);

  return {
    accuracy,
    buckets: bucketsOut,
    categories,
    deferLeaderboard: deferRows,
    energyByHour,
  };
}
