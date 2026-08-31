/**
 * db/reset-history.ts — wipe everything the app has *learned* or *generated*, so
 * calibration only ever accumulates from real days.
 *
 *   npm run db:reset-history
 *
 * Deletes all rows from time_log, calibration, blocks, plans, overflow, and
 * resets every task's defer_count to 0, clears completed_at, and flips any
 * done task back to active. Tasks, buckets, habits, the day profile and the
 * seed history are left alone.
 *
 * Same guard as the seed: prints what it will do, then requires an interactive
 * "yes"; aborts (changing nothing) if stdin is not a TTY.
 */

import "./load-env";

import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, closeDb } from "./index";
import { timeLog, blocks, overflow, plans, calibration, tasks } from "./schema";
import { confirmDestructive } from "./confirm";

async function count(table: PgTable): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row.n;
}

async function main() {
  const [tl, bl, ov, pl, cal, tk] = await Promise.all([
    count(timeLog),
    count(blocks),
    count(overflow),
    count(plans),
    count(calibration),
    count(tasks),
  ]);

  if (tl + bl + ov + pl + cal === 0) {
    const [{ n: dirty }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(sql`${tasks.deferCount} <> 0 or ${tasks.completedAt} is not null or ${tasks.status} = 'done'`);
    if (dirty === 0) {
      console.log("Already a clean slate — no history and no task state to reset.");
      return;
    }
  }

  const ok = await confirmDestructive(
    [
      "db:reset-history — permanently deletes ALL planning history:",
      `  time_log     : ${tl}`,
      `  blocks       : ${bl}`,
      `  overflow     : ${ov}`,
      `  plans        : ${pl}`,
      `  calibration  : ${cal}`,
      "",
      `and resets ${tk} task(s): defer_count -> 0, completed_at -> null, done -> active.`,
      "",
      "Tasks, buckets, habits, the day profile and seed history are kept.",
    ],
    'Type exactly "yes" to wipe all history: ',
  );
  if (!ok) {
    process.exitCode = 1;
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(timeLog);
    await tx.delete(overflow);
    await tx.delete(blocks);
    await tx.update(plans).set({ parentPlanId: null });
    await tx.delete(plans);
    await tx.delete(calibration);
    await tx.update(tasks).set({ status: "active" }).where(eq(tasks.status, "done"));
    await tx.update(tasks).set({ deferCount: 0, completedAt: null });
  });

  console.log("\nHistory cleared. Calibration will only learn from real days now.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
