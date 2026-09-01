/**
 * lib/plan-geometry.ts — the positional sanity checks for a day's blocks.
 *
 * These are the SPEC 6.1 checks that are about *where blocks sit*: no overlap,
 * inside a working window, clear of commitments and protected blocks, under the
 * daily cap. They run in code (models drift on arithmetic) and they only ever
 * *report* — nothing here moves a block.
 *
 * Pure module (no db, no "server-only") so it can be unit-tested and shared by
 * `lib/ai/validate.ts` (compose) and the drag / assistant edit path
 * (`lib/plan.ts`).
 */

import { hmToMinutes, minutesToHm, overlaps, type Interval } from "@/lib/time";

export type GeometryContext = {
  /** working windows for the day, as [start,end] HH:mm pairs */
  workWindows: [string, string][];
  commitments: { start: string; end: string }[];
  protectedBlocks: { label: string; start: string; end: string }[];
  dailyCapMin: number;
};

export type GeoBlock = {
  startMin: number;
  endMin: number;
  kind: string;
  title: string;
};

/** [start,end] on a 24h clock -> 1-2 minute intervals, splitting midnight wraps. */
export function clockToIntervals(pairs: [string, string][]): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of pairs) {
    let s: number;
    let e: number;
    try {
      s = hmToMinutes(a);
      e = hmToMinutes(b);
    } catch {
      continue; // malformed config — not the plan's fault, skip
    }
    if (e > s) {
      out.push({ start: s, end: e });
    } else if (e < s) {
      out.push({ start: s, end: 1440 });
      out.push({ start: 0, end: e });
    }
  }
  return out;
}

/**
 * Return a list of human-readable violations for the given blocks ([] = clean).
 * `blocks` are minutes-since-IST-midnight; order does not matter.
 */
export function checkDayGeometry(
  blocks: GeoBlock[],
  ctx: GeometryContext,
): string[] {
  const v: string[] = [];

  const clean = blocks.filter((b) => {
    if (!(b.endMin > b.startMin)) {
      v.push(`"${b.title}" ends at or before it starts`);
      return false;
    }
    return true;
  });

  // --- overlaps between blocks ---
  const byStart = [...clean].sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < byStart.length; i++) {
    if (byStart[i].startMin < byStart[i - 1].endMin) {
      v.push(`"${byStart[i - 1].title}" and "${byStart[i].title}" overlap`);
    }
  }

  // --- inside a working window ---
  // Habits are exempt: they are personal, not work (a 06:30 gym session against
  // a 09:00 work window is the SPEC's own example). They must still clear
  // commitments and protected blocks, and must not overlap anything.
  const windows = clockToIntervals(ctx.workWindows);
  for (const b of clean) {
    if (b.kind === "habit") continue;
    const inside = windows.some((w) => b.startMin >= w.start && b.endMin <= w.end);
    if (!inside) {
      v.push(
        `"${b.title}" (${minutesToHm(b.startMin)}–${minutesToHm(b.endMin)}) is outside the working windows`,
      );
    }
  }

  // --- commitment / protected collisions ---
  const commitments = clockToIntervals(
    ctx.commitments.map((c) => [c.start, c.end] as [string, string]),
  );
  const protectedIv = clockToIntervals(
    ctx.protectedBlocks.map((p) => [p.start, p.end] as [string, string]),
  );
  for (const b of clean) {
    const iv: Interval = { start: b.startMin, end: b.endMin };
    // A `fixed` block *is* a commitment, so it is allowed to coincide with one.
    if (b.kind !== "fixed" && commitments.some((c) => overlaps(iv, c))) {
      v.push(`"${b.title}" is scheduled over a fixed commitment`);
    }
    if (protectedIv.some((p) => overlaps(iv, p))) {
      v.push(`"${b.title}" is scheduled over a protected block`);
    }
  }

  // --- daily cap ---
  // The cap is a ceiling on WORK. Time inside fixed commitments counts (SPEC
  // rule 6). Habits do not — football is not work, and charging a 2h habit
  // against the cap makes the planner under-schedule on the days you have one.
  // Breaks do not either: the planner inserts them itself as recovery, so
  // billing them to the cap would charge you for its own scheduling decision.
  const scheduled = clean
    .filter((b) => b.kind !== "habit" && b.kind !== "break")
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
  if (scheduled > ctx.dailyCapMin) {
    v.push(
      `total scheduled work ${scheduled} min exceeds the daily cap of ${ctx.dailyCapMin} min`,
    );
  }

  return v;
}
