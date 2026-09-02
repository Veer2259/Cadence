/**
 * lib/focus-db.ts — reading and recomputing learned focus hours.
 * The scoring maths lives in lib/focus.ts, which stays pure and tested.
 */

import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { blocks, plans, focusScores } from "@/db/schema";
import { istMinutesOfDay } from "@/lib/time";
import {
  scoreAllHours,
  preferredHours,
  focusWindows,
  type FocusSample,
  type FocusScore,
  type EffectiveFocus,
} from "@/lib/focus";

/**
 * Rebuild every hour's score from history. Called at debrief.
 *
 * Samples come from DEEP-category task blocks on committed plans. A block is
 * attributed to every hour it overlaps, so a 90-minute block starting at 09:30
 * is evidence about both 09:00 and 10:00 — the question is whether the SLOT
 * suits deep work, not just where the block happened to begin.
 */
export async function recomputeFocusScores(): Promise<FocusScore[]> {
  const rows = await db
    .select({
      startAt: blocks.startAt,
      endAt: blocks.endAt,
      rawEstimateMin: blocks.rawEstimateMin,
      actualMin: blocks.actualMin,
      status: blocks.status,
    })
    .from(blocks)
    .innerJoin(plans, eq(blocks.planId, plans.id))
    .where(
      and(
        eq(blocks.kind, "task"),
        eq(blocks.category, "deep"),
        inArray(blocks.status, ["done", "partial", "skipped"]),
        // only debriefed days are settled evidence
        isNotNull(plans.debriefedAt),
      ),
    );

  const samples: FocusSample[] = [];
  for (const r of rows) {
    const startMin = istMinutesOfDay(r.startAt);
    const endRaw = istMinutesOfDay(r.endAt);
    const endMin = endRaw <= startMin ? 1440 : endRaw;
    const firstHour = Math.floor(startMin / 60);
    const lastHour = Math.floor((endMin - 1) / 60);
    for (let h = firstHour; h <= lastHour && h <= 23; h++) {
      samples.push({
        hour: h,
        rawEstimateMin: r.rawEstimateMin,
        actualMin: r.status === "skipped" ? null : r.actualMin,
        skipped: r.status === "skipped",
      });
    }
  }

  const scored = scoreAllHours(samples);

  // Upsert, preserving any manual override — the person's correction outlives
  // a recompute.
  for (const s of scored) {
    await db
      .insert(focusScores)
      .values({
        hour: s.hour,
        score: s.score == null ? null : String(s.score),
        meanRatio: s.meanRatio == null ? null : String(s.meanRatio),
        skipRate: String(s.skipRate),
        sampleN: s.sampleN,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: focusScores.hour,
        set: {
          score: s.score == null ? null : String(s.score),
          meanRatio: s.meanRatio == null ? null : String(s.meanRatio),
          skipRate: String(s.skipRate),
          sampleN: s.sampleN,
          updatedAt: new Date(),
        },
      });
  }
  return scored;
}

export type StoredFocus = FocusScore & { manualScore: number | null };

/** Every stored hour, with its manual override if there is one. */
export async function loadFocusScores(): Promise<StoredFocus[]> {
  const rows = await db.select().from(focusScores).orderBy(focusScores.hour);
  return rows.map((r) => ({
    hour: r.hour,
    score: r.score == null ? null : Number(r.score),
    meanRatio: r.meanRatio == null ? null : Number(r.meanRatio),
    skipRate: Number(r.skipRate),
    sampleN: r.sampleN,
    confident: r.sampleN >= 3,
    manualScore: r.manualScore == null ? null : Number(r.manualScore),
  }));
}

/**
 * The focus windows compose should be told to prefer, as [start,end) HH:mm.
 * EMPTY when there is no evidence — the caller must say so rather than
 * substituting a default.
 */
export async function learnedFocusWindows(): Promise<{
  windows: [string, string][];
  preferred: EffectiveFocus[];
  hasEvidence: boolean;
}> {
  const stored = await loadFocusScores();
  const overrides = new Map<number, number>();
  for (const s of stored) if (s.manualScore != null) overrides.set(s.hour, s.manualScore);

  const preferred = preferredHours(stored, overrides);
  return {
    windows: focusWindows(preferred),
    preferred,
    hasEvidence: stored.some((s) => s.confident) || overrides.size > 0,
  };
}

/** Set or clear a manual override for one hour. */
export async function setFocusOverride(
  hour: number,
  score: number | null,
): Promise<void> {
  if (hour < 0 || hour > 23) throw new Error("Hour must be 0..23.");
  await db
    .insert(focusScores)
    .values({
      hour,
      manualScore: score == null ? null : String(score),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: focusScores.hour,
      set: { manualScore: score == null ? null : String(score), updatedAt: new Date() },
    });
}
