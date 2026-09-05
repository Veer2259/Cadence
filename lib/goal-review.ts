/**
 * lib/goal-review.ts — the descriptive read of how goals are going.
 *
 * SPEC's rule for the weekly review holds throughout: report what happened and
 * by how much, never prescribe. "Four weeks left, seven weeks of work at your
 * current rate" is the sentence. "Try harder" is not, and neither is "you
 * should drop scope" — the person decides what to do about the gap.
 */

import "server-only";
import { and, gte, lte, eq } from "drizzle-orm";
import { db } from "@/db";
import { weeklyTargets, buckets, timeLog } from "@/db/schema";
import { istToday, addIstDays } from "@/lib/time";
import { weekStartOf } from "@/lib/goals";

export type TargetOutcome = {
  weekStart: string;
  bucket: string;
  description: string;
  status: "planned" | "hit" | "missed" | "partial" | "dropped";
  targetHours: number | null;
  actualHours: number;
};

/** Weekly targets over the last `weeks` weeks, with what actually got logged. */
export async function targetHistory(
  weeks = 8,
  todayStr = istToday(),
): Promise<TargetOutcome[]> {
  const thisMonday = weekStartOf(todayStr);
  const from = addIstDays(thisMonday, -7 * (weeks - 1));

  const rows = await db
    .select({
      weekStart: weeklyTargets.weekStart,
      bucketId: weeklyTargets.bucketId,
      bucket: buckets.name,
      description: weeklyTargets.description,
      status: weeklyTargets.status,
      targetHours: weeklyTargets.targetHours,
    })
    .from(weeklyTargets)
    .innerJoin(buckets, eq(weeklyTargets.bucketId, buckets.id))
    .where(and(gte(weeklyTargets.weekStart, from), lte(weeklyTargets.weekStart, thisMonday)))
    .orderBy(weeklyTargets.weekStart);

  if (rows.length === 0) return [];

  const logged = await db
    .select({ bucketId: timeLog.bucketId, date: timeLog.date, durationMin: timeLog.durationMin })
    .from(timeLog)
    .where(and(gte(timeLog.date, from), lte(timeLog.date, addIstDays(thisMonday, 6))));

  const key = (b: string, w: string) => `${b}:${w}`;
  const mins = new Map<string, number>();
  for (const l of logged) {
    if (!l.bucketId) continue;
    const k = key(l.bucketId, weekStartOf(l.date));
    mins.set(k, (mins.get(k) ?? 0) + l.durationMin);
  }

  return rows.map((r) => ({
    weekStart: r.weekStart,
    bucket: r.bucket,
    description: r.description,
    status: r.status,
    targetHours: r.targetHours == null ? null : Number(r.targetHours),
    actualHours:
      Math.round(((mins.get(key(r.bucketId, r.weekStart)) ?? 0) / 60) * 10) / 10,
  }));
}

export type OutcomeProjection = {
  bucket: string;
  outcome: string;
  targetDate: string;
  weeksLeft: number;
  /** mean hours per week actually logged in this bucket, last 8 weeks */
  rateHoursPerWeek: number;
  /** hours per week the stated target implies */
  targetHoursPerWeek: number | null;
  /** hours the remaining weeks provide at the current rate */
  hoursAtCurrentRate: number;
  /** hours the remaining weeks would provide at the stated target rate */
  hoursIfOnTarget: number | null;
  /**
   * How the two compare, stated plainly. Null when there is not enough
   * evidence, or no hour target to compare against — in which case saying
   * nothing is more honest than a number.
   */
  verdict: string | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * For each bucket with an outcome and a date: how many weeks are left, and
 * what the remaining weeks provide at the rate actually being sustained.
 * Descriptive. It never recommends an action.
 */
export async function outcomeProjections(
  todayStr = istToday(),
): Promise<OutcomeProjection[]> {
  const thisMonday = weekStartOf(todayStr);
  const from = addIstDays(thisMonday, -7 * 8);

  const rows = await db
    .select({
      id: buckets.id,
      name: buckets.name,
      outcome: buckets.outcome,
      targetDate: buckets.outcomeTargetDate,
      status: buckets.status,
      active: buckets.active,
    })
    .from(buckets);

  const live = rows.filter(
    (r) => r.active && r.status === "active" && r.outcome && r.targetDate,
  );
  if (live.length === 0) return [];

  const logged = await db
    .select({ bucketId: timeLog.bucketId, durationMin: timeLog.durationMin })
    .from(timeLog)
    .where(and(gte(timeLog.date, from), lte(timeLog.date, addIstDays(thisMonday, -1))));

  const minsByBucket = new Map<string, number>();
  for (const l of logged) {
    if (!l.bucketId) continue;
    minsByBucket.set(l.bucketId, (minsByBucket.get(l.bucketId) ?? 0) + l.durationMin);
  }

  return live.map((r) => {
    const rate = round1((minsByBucket.get(r.id) ?? 0) / 60 / 8);
    const weeksLeft = Math.max(
      0,
      Math.round(
        (Date.parse(`${weekStartOf(r.targetDate as string)}T00:00:00Z`) -
          Date.parse(`${thisMonday}T00:00:00Z`)) /
          (7 * 86_400_000),
      ),
    );
    const targetRate: number | null = null;
    const atRate = round1(rate * weeksLeft);
    const onTarget = targetRate != null ? round1(targetRate * weeksLeft) : null;

    let verdict: string | null = null;
    if (targetRate != null && weeksLeft > 0) {
      const gap = round1(onTarget! - atRate);
      verdict =
        gap <= 0
          ? `${weeksLeft} week${weeksLeft === 1 ? "" : "s"} left. At ${rate}h/week you get ${atRate}h, which meets the ${targetRate}h/week you set.`
          : `${weeksLeft} week${weeksLeft === 1 ? "" : "s"} left. At ${rate}h/week you get ${atRate}h; the ${targetRate}h/week you set would give ${onTarget}h — a gap of ${gap}h.`;
    } else if (weeksLeft === 0) {
      verdict = `The target date falls in this week.`;
    }

    return {
      bucket: r.name,
      outcome: r.outcome as string,
      targetDate: r.targetDate as string,
      weeksLeft,
      rateHoursPerWeek: rate,
      targetHoursPerWeek: targetRate,
      hoursAtCurrentRate: atRate,
      hoursIfOnTarget: onTarget,
      verdict,
    };
  });
}
