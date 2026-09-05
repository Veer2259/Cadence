/**
 * lib/emphasis-safety.ts — the check that emphasis has not become a constraint.
 *
 * Emphasis is a preference. The failure it could reintroduce is precise and has
 * happened here before: declared sharp hours were read as a hard rule and a
 * task was deferred with 235 free minutes in the day. The detector below states
 * that failure as arithmetic rather than as prompt wording.
 *
 * NOTE ON WHERE THIS LIVES. This is deliberately NOT wired into
 * lib/ai/validate.ts, because post-validation was explicitly out of scope for
 * the change that added emphasis. So it detects, it does not gate: a plan that
 * trips it is still saved. Wiring it into validatePlan is a one-line call and
 * would turn this from an assertion into a guarantee.
 */

import type { ComposeInput } from "@/lib/ai/compose-types";
import type { PlanResult } from "@/lib/ai/schemas";
import { hmToMinutes } from "@/lib/time";

/** Total minutes inside the working windows, after clipping to planFromMin. */
export function workingMinutes(input: ComposeInput): number {
  return input.workWindows.reduce((n, [a, b]) => {
    const start = Math.max(hmToMinutes(a), input.planFromMin);
    const end = hmToMinutes(b);
    return n + Math.max(0, end - start);
  }, 0);
}

/** Minutes the plan actually fills inside the day. */
export function scheduledMinutes(plan: PlanResult): number {
  return plan.blocks.reduce(
    (n, b) => n + Math.max(0, hmToMinutes(b.end) - hmToMinutes(b.start)),
    0,
  );
}

export type PrematureOverflow = {
  taskId: string;
  /** what the task needed */
  neededMin: number;
  /** what was still unscheduled inside the working windows */
  freeMin: number;
};

/**
 * Overflow rows that had room to be scheduled.
 *
 * A task belongs in `overflow` only when there is genuinely no time for it. If
 * unscheduled working minutes cover its calibrated estimate, its presence in
 * overflow is unexplained — and when the day carries an emphasis ordering, the
 * most likely explanation is that the ordering was treated as a rule.
 */
export function prematureOverflow(
  input: ComposeInput,
  plan: PlanResult,
): PrematureOverflow[] {
  const free = workingMinutes(input) - scheduledMinutes(plan);
  if (free <= 0) return [];

  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const out: PrematureOverflow[] = [];
  for (const o of plan.overflow) {
    const task = byId.get(o.taskId);
    if (!task) continue;
    const needed = task.calibratedEstimateMin;
    if (needed <= free) {
      out.push({ taskId: o.taskId, neededMin: needed, freeMin: free });
    }
  }
  return out;
}

/**
 * One descriptive line per premature overflow, naming the arithmetic.
 *
 * Phrased the way the original bug should have been reported: the number of
 * free minutes is the thing that makes it obviously wrong.
 */
export function describePrematureOverflow(
  rows: PrematureOverflow[],
  titleFor: (taskId: string) => string,
): string[] {
  return rows.map(
    (r) =>
      `"${titleFor(r.taskId)}" was sent to overflow needing ${r.neededMin} min, ` +
      `with ${r.freeMin} working minutes still unscheduled.`,
  );
}
