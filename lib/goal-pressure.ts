/**
 * lib/goal-pressure.ts — how far behind a week's target is, as a number.
 *
 * Pure: no db, no "server-only", so it is unit-testable. The caller supplies
 * the week's facts; this decides what "behind" means and by how much.
 *
 * A task linked to a target that is behind is more urgent than one that is not
 * — but this is EVIDENCE for compose, not an instruction. It sits alongside
 * deadline pressure and defer count, and never overrides a hard constraint.
 */

export type TargetProgress = {
  targetHours: number | null;
  actualHours: number;
  totalTasks: number;
  doneTasks: number;
  /** 0..6 — how far through the week we are (Mon = 0) */
  dayIndexInWeek: number;
};

export type GoalPressure = {
  /** 0 = on or ahead of pace, 1 = nothing done with the week gone */
  behindBy: number;
  state: "ahead" | "on_track" | "slipping" | "behind";
  /** a plain-language line compose can quote; null when there is nothing to say */
  note: string | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Expected fraction of the week's work that should be done by now. Uses whole
 * elapsed days: on Monday nothing is expected yet, by Sunday all of it is.
 */
export function expectedFraction(dayIndexInWeek: number): number {
  const d = Math.max(0, Math.min(6, dayIndexInWeek));
  return d / 6;
}

export function goalPressure(p: TargetProgress): GoalPressure {
  const expected = expectedFraction(p.dayIndexInWeek);

  // Prefer hours when a target has them; fall back to task completion.
  let actualFraction: number | null = null;
  let detail = "";
  if (p.targetHours != null && p.targetHours > 0) {
    actualFraction = Math.min(1, p.actualHours / p.targetHours);
    detail = `${round1(p.actualHours)}h of ${round1(p.targetHours)}h`;
  } else if (p.totalTasks > 0) {
    actualFraction = p.doneTasks / p.totalTasks;
    detail = `${p.doneTasks} of ${p.totalTasks} tasks`;
  }

  if (actualFraction === null) {
    return { behindBy: 0, state: "on_track", note: null };
  }

  const behindBy = Math.max(0, round1(expected - actualFraction));
  const state: GoalPressure["state"] =
    actualFraction >= expected + 0.15
      ? "ahead"
      : behindBy === 0
        ? "on_track"
        : behindBy < 0.25
          ? "slipping"
          : "behind";

  if (state === "on_track" || state === "ahead") {
    return { behindBy, state, note: null };
  }

  const pct = Math.round(behindBy * 100);
  return {
    behindBy,
    state,
    note: `${detail} with ${Math.round(expected * 100)}% of the week gone — ${pct} points behind pace`,
  };
}
