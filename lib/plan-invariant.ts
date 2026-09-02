/**
 * lib/plan-invariant.ts — every task that leaves a plan must leave a trace.
 *
 * THE INVARIANT: a task that was in a plan's input is either scheduled as a
 * block or recorded in overflow with a reason. Never neither.
 *
 * This exists because a task once vanished with no record at all — no block, no
 * overflow row, nothing in the UI. That is the worst failure this app can have:
 * with twenty tasks in flight it is invisible, and the person's trust in the
 * plan is the whole product. A loud failure is strictly better than a silent
 * one, so callers are expected to REFUSE the write rather than save a plan that
 * has lost something.
 *
 * Pure module: no db, no "server-only", so every path can be tested.
 */

export type TaskRef = { id: string; title: string };

/**
 * Tasks present in `inputTasks` that appear in neither the blocks nor the
 * overflow. Empty means the plan accounts for everything it was given.
 */
export function findUnaccountedTasks(args: {
  inputTasks: TaskRef[];
  blockTaskIds: (string | null)[];
  overflowTaskIds: string[];
}): TaskRef[] {
  const scheduled = new Set(args.blockTaskIds.filter((x): x is string => !!x));
  const deferred = new Set(args.overflowTaskIds);
  return args.inputTasks.filter((t) => !scheduled.has(t.id) && !deferred.has(t.id));
}

/** Thrown instead of persisting a plan that has lost a task. */
export class PlanAccountingError extends Error {
  readonly code = "PLAN_ACCOUNTING";
  constructor(readonly lost: TaskRef[]) {
    super(
      `This plan would lose ${lost.length} task${lost.length === 1 ? "" : "s"} ` +
        `with no record of why: ${lost.map((t) => `"${t.title}"`).join(", ")}. ` +
        `Nothing was saved — every task that leaves a plan must leave a trace.`,
    );
    this.name = "PlanAccountingError";
  }
}

/** Throw unless every input task is accounted for. */
export function assertTasksAccountedFor(args: {
  inputTasks: TaskRef[];
  blockTaskIds: (string | null)[];
  overflowTaskIds: string[];
}): void {
  const lost = findUnaccountedTasks(args);
  if (lost.length > 0) throw new PlanAccountingError(lost);
}
