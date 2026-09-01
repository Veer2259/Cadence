/**
 * lib/milestones.ts — a name, a target date, a bucket. Nothing else.
 *
 * Deliberately NOT a project manager: no dependencies, no sub-milestones, no
 * stored percent-complete. Progress is derived from the tasks that link to a
 * milestone, so it can never drift out of sync with the actual work.
 */

import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { milestones, tasks, buckets } from "@/db/schema";

export type MilestoneProgress = {
  id: string;
  name: string;
  targetDate: string;
  bucketId: string | null;
  bucketName: string | null;
  archived: boolean;
  completedAt: Date | null;
  /** tasks linked to this milestone */
  totalTasks: number;
  doneTasks: number;
  /** 0..1, or null when nothing is linked yet */
  fraction: number | null;
  /** negative = overdue */
  daysLeft: number;
};

/** Whole IST days between today and a target date. */
function daysUntil(targetDate: string, todayStr: string): number {
  const a = Date.parse(`${todayStr}T00:00:00Z`);
  const b = Date.parse(`${targetDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export async function listMilestoneProgress(
  todayStr: string,
  includeArchived = false,
): Promise<MilestoneProgress[]> {
  const rows = await db
    .select({
      id: milestones.id,
      name: milestones.name,
      targetDate: milestones.targetDate,
      bucketId: milestones.bucketId,
      completedAt: milestones.completedAt,
      archived: milestones.archived,
      bucketName: buckets.name,
    })
    .from(milestones)
    .leftJoin(buckets, eq(milestones.bucketId, buckets.id))
    .orderBy(asc(milestones.targetDate));

  const visible = includeArchived ? rows : rows.filter((r) => !r.archived);
  if (visible.length === 0) return [];

  // one grouped query rather than one per milestone
  const counts = await db
    .select({
      milestoneId: tasks.milestoneId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
    })
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.milestoneId,
          visible.map((r) => r.id),
        ),
        // a dropped task is not progress and not outstanding work
        sql`${tasks.status} <> 'dropped'`,
      ),
    )
    .groupBy(tasks.milestoneId);

  const byId = new Map(counts.map((c) => [c.milestoneId as string, c]));

  return visible.map((r) => {
    const c = byId.get(r.id);
    const total = c?.total ?? 0;
    const done = c?.done ?? 0;
    return {
      id: r.id,
      name: r.name,
      targetDate: r.targetDate,
      bucketId: r.bucketId ?? null,
      bucketName: r.bucketName ?? null,
      archived: r.archived,
      completedAt: r.completedAt,
      totalTasks: total,
      doneTasks: done,
      fraction: total > 0 ? done / total : null,
      daysLeft: daysUntil(r.targetDate, todayStr),
    };
  });
}
