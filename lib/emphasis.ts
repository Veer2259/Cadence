/**
 * lib/emphasis.ts — which buckets a particular day leans towards.
 *
 * A PREFERENCE, never a constraint. It may order placement and break ties when
 * two pieces of work compete for the same slot; it may NEVER cause a task to be
 * deferred or sent to overflow while working minutes remain unused.
 *
 * That sentence is load-bearing. This project already shipped the other version
 * once: declared sharp hours were read by the model as a hard constraint, and a
 * task was deferred with 235 free minutes left in the day (SPEC §3
 * `focus_scores`). Emphasis has exactly the same shape — a soft signal that
 * looks like a rule — so the prompt says so explicitly, and
 * lib/ai/validate.ts is what actually holds the line.
 *
 * Emphasis also never outranks `must_do_today`, which stays a hard pre-model
 * fit check in lib/must-do.ts and is untouched by any of this.
 */

import "server-only";
import { desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { bucketEmphasis, buckets } from "@/db/schema";
import { addIstDays, istToday } from "@/lib/time";

export type EmphasisView = {
  date: string;
  /** ordered, most emphasised first; only buckets that still exist */
  bucketIds: string[];
  bucketNames: string[];
  note: string | null;
};

/**
 * The ordering for one date, with retired buckets dropped.
 *
 * Ids are stored, not names, because buckets are renameable — but a bucket can
 * also be retired after a day was emphasised, and SPEC §1 principle 7 says
 * buckets are read from the database at runtime. An id that no longer resolves
 * is skipped rather than surfaced as a blank or an error.
 */
export async function emphasisFor(date: string): Promise<EmphasisView | null> {
  const [row] = await db
    .select()
    .from(bucketEmphasis)
    .where(eq(bucketEmphasis.date, date))
    .limit(1);
  if (!row) return null;

  const ids = Array.isArray(row.bucketIds) ? row.bucketIds : [];
  if (ids.length === 0) return null;

  const known = await db
    .select({ id: buckets.id, name: buckets.name })
    .from(buckets);
  const nameById = new Map(known.map((b) => [b.id, b.name]));

  const live = ids.filter((id) => nameById.has(id));
  if (live.length === 0) return null;

  return {
    date: row.date,
    bucketIds: live,
    bucketNames: live.map((id) => nameById.get(id) as string),
    note: row.note,
  };
}

/** Set (or replace) the ordering for a date. One row per date, so this upserts. */
export async function setEmphasis(args: {
  date: string;
  bucketIds: string[];
  note?: string | null;
}): Promise<void> {
  const ids = [...new Set(args.bucketIds)].filter(Boolean);
  if (ids.length === 0) {
    await db.delete(bucketEmphasis).where(eq(bucketEmphasis.date, args.date));
    return;
  }
  await db
    .insert(bucketEmphasis)
    .values({ date: args.date, bucketIds: ids, note: args.note ?? null })
    .onConflictDoUpdate({
      target: bucketEmphasis.date,
      set: { bucketIds: ids, note: args.note ?? null },
    });
}

/** Resolve bucket names to ids, case-insensitively — the assistant rail speaks names. */
export async function resolveBucketNames(
  names: string[],
): Promise<{ ids: string[]; unknown: string[] }> {
  const rows = await db.select({ id: buckets.id, name: buckets.name }).from(buckets);
  const byName = new Map(rows.map((r) => [r.name.toLowerCase().trim(), r.id]));
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const id = byName.get(raw.toLowerCase().trim());
    if (id) ids.push(id);
    else unknown.push(raw);
  }
  return { ids, unknown };
}

/** Every emphasis row in the last `days` days, newest first. For Part 4. */
export async function recentEmphasis(
  days = 7,
  now: Date = new Date(),
): Promise<{ date: string; bucketIds: string[] }[]> {
  const from = addIstDays(istToday(now), -(days - 1));
  const rows = await db
    .select({ date: bucketEmphasis.date, bucketIds: bucketEmphasis.bucketIds })
    .from(bucketEmphasis)
    .where(gte(bucketEmphasis.date, from))
    .orderBy(desc(bucketEmphasis.date));
  return rows.map((r) => ({
    date: r.date,
    bucketIds: Array.isArray(r.bucketIds) ? r.bucketIds : [],
  }));
}
