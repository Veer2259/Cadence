/**
 * lib/goal-horizon.ts — how far away a goal is, and therefore what shape its
 * plan takes.
 *
 * A goal more than SHORT_HORIZON_WEEKS away gets weekly targets first, then
 * tasks for the current week against those targets. A goal at or inside that
 * horizon skips the weekly-target layer entirely and gets tasks proposed
 * straight against the goal.
 *
 * That branch exists because the layer was previously mandatory, and for a
 * short goal it produced nothing: the breakdown prompt asks for "one per week
 * from the coming Monday to the target date", which for a target two days out
 * is an empty list. Kickoff then found zero targets and returned zero
 * candidates without ever calling the model, so a goal with a near deadline
 * produced no tasks at all and said nothing about why.
 */

import { addIstDays } from "@/lib/time";

/**
 * The one place this number lives. Weeks, not days, because the layer being
 * skipped is a WEEKLY one — below four weeks there are too few weeks for
 * per-week slices to carry information the goal does not already carry.
 */
export const SHORT_HORIZON_WEEKS = 4;

export type GoalHorizon = {
  /** whole days from `today` to the target date; negative when overdue */
  days: number;
  /** `days / 7`, unrounded */
  weeks: number;
  /**
   * "targets" — far enough out to slice into weeks first.
   * "direct"  — at or inside the horizon; propose tasks against the goal.
   * "none"    — no target date, so there is no horizon to branch on.
   */
  mode: "targets" | "direct" | "none";
};

/** Whole days between two IST dates. Both are YYYY-MM-DD, so this is exact. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00+05:30`);
  const b = Date.parse(`${to}T00:00:00+05:30`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Which shape a goal's plan takes.
 *
 * A null target date means "genuinely open" (SPEC 6.7 allows it), and an open
 * goal cannot be sliced into a finite number of weeks — so it takes the direct
 * path rather than being forced through a layer that has no end to divide.
 *
 * The boundary is INCLUSIVE of the short side: exactly four weeks out is
 * "direct". Four weekly targets where the fourth ends on the deadline itself
 * adds a layer without adding information.
 */
export function goalHorizon(
  targetDate: string | null,
  today: string,
): GoalHorizon {
  if (!targetDate) return { days: 0, weeks: 0, mode: "none" };
  const days = daysBetween(today, targetDate);
  const weeks = days / 7;
  return {
    days,
    weeks,
    mode: weeks > SHORT_HORIZON_WEEKS ? "targets" : "direct",
  };
}

/**
 * The Mondays a long-horizon goal should get weekly targets for, starting with
 * the week the person is IN.
 *
 * Breakdown previously proposed "from the coming Monday", while the Goals
 * screen and kickoff both read the CURRENT week — so a freshly accepted set of
 * targets was invisible until the following Monday. Starting from this week's
 * Monday is what makes the handoff to task proposal work the same day.
 */
export function targetWeeksFor(
  weekStartOfToday: string,
  targetDate: string,
): string[] {
  const out: string[] = [];
  let cursor = weekStartOfToday;
  // A week counts if it starts on or before the deadline.
  for (let i = 0; i < 104 && daysBetween(cursor, targetDate) >= 0; i++) {
    out.push(cursor);
    cursor = addIstDays(cursor, 7);
  }
  return out;
}
