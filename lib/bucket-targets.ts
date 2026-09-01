/**
 * lib/bucket-targets.ts — weekly intended hours per bucket versus logged hours.
 *
 * A statement of intent only: nothing schedules against a target and nothing
 * enforces one. The Week screen shows the gap and leaves the judgement to the
 * person.
 */

import "server-only";
import { and, gte, lte, eq } from "drizzle-orm";
import { db } from "@/db";
import { buckets, timeLog } from "@/db/schema";

export type BucketTargetRow = {
  bucketId: string;
  bucket: string;
  /** intended minutes this week, null when no target is set */
  targetMin: number | null;
  actualMin: number;
  /** actual ÷ target, null when there is no target */
  ratio: number | null;
};

/**
 * Logged minutes per bucket between two IST dates (inclusive), against each
 * bucket's weekly target. Buckets with neither a target nor logged time are
 * omitted — an empty row is noise.
 */
export async function bucketTargets(
  fromDate: string,
  toDate: string,
): Promise<BucketTargetRow[]> {
  const bucketRows = await db
    .select({
      id: buckets.id,
      name: buckets.name,
      targetMin: buckets.weeklyTargetMin,
      active: buckets.active,
    })
    .from(buckets);

  const logged = await db
    .select({
      bucketId: timeLog.bucketId,
      durationMin: timeLog.durationMin,
    })
    .from(timeLog)
    .where(and(gte(timeLog.date, fromDate), lte(timeLog.date, toDate)));

  const actualByBucket = new Map<string, number>();
  for (const r of logged) {
    if (!r.bucketId) continue;
    actualByBucket.set(r.bucketId, (actualByBucket.get(r.bucketId) ?? 0) + r.durationMin);
  }

  return bucketRows
    .map((b) => {
      const actualMin = actualByBucket.get(b.id) ?? 0;
      return {
        bucketId: b.id,
        bucket: b.name,
        targetMin: b.targetMin ?? null,
        actualMin,
        ratio: b.targetMin && b.targetMin > 0 ? actualMin / b.targetMin : null,
      };
    })
    .filter((r) => r.targetMin !== null || r.actualMin > 0)
    .sort((a, b) => b.actualMin - a.actualMin);
}

/** Set or clear a bucket's weekly target. */
export async function setBucketTarget(
  bucketId: string,
  targetMin: number | null,
): Promise<void> {
  await db.update(buckets).set({ weeklyTargetMin: targetMin }).where(eq(buckets.id, bucketId));
}
