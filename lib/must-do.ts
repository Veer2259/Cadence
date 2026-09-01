/**
 * lib/must-do.ts — the must-do-today fit check.
 *
 * A must-do task is a HARD constraint, not a strong hint: compose is not
 * allowed to send one to overflow. That only works if we can tell the
 * difference between "the model was lazy" and "these genuinely do not fit" —
 * so the arithmetic happens here, in code, BEFORE the model is called.
 *
 * When they don't fit we say exactly which ones and by how much, rather than
 * letting the planner quietly drop one and hoping it isn't noticed.
 *
 * Pure module: no db, no "server-only".
 */

import {
  subtractIntervals,
  sumIntervals,
  toIntervals,
  type Interval,
  type Window,
} from "@/lib/time";

export type MustDoTask = { id: string; title: string; minutes: number };

export type MustDoFit = {
  fits: boolean;
  /** total calibrated minutes the must-do tasks need */
  neededMin: number;
  /** plannable minutes left today, after commitments and protected blocks */
  availableMin: number;
  /** how far over we are; 0 when it fits */
  shortfallMin: number;
  tasks: MustDoTask[];
};

/** Minutes genuinely available inside `windows`, once cuts are removed. */
export function plannableMinutes(windows: Window[], cuts: Window[]): number {
  let base: Interval[];
  try {
    base = toIntervals(windows);
  } catch {
    return 0;
  }
  const cutIvs: Interval[] = [];
  for (const [a, b] of cuts) {
    try {
      const [iv] = toIntervals([[a, b]]);
      cutIvs.push(iv);
    } catch {
      // a cut that wraps midnight (e.g. sleep) — split it
      try {
        const s = toIntervals([[a, "24:00"]])[0];
        cutIvs.push(s);
        const e = toIntervals([["00:00", b]])[0];
        cutIvs.push(e);
      } catch {
        /* malformed config, skip */
      }
    }
  }
  return sumIntervals(subtractIntervals(base, cutIvs));
}

/**
 * Do the must-do tasks fit in what's left of the day?
 *
 * `windows` should already be clipped to the current time (compose clips them),
 * so this answers the question for the time actually remaining.
 */
export function checkMustDoFit(args: {
  tasks: MustDoTask[];
  windows: Window[];
  /** commitments + protected blocks — anything that cannot be planned over */
  cuts: Window[];
  /** the daily cap also bounds what can be scheduled */
  dailyCapMin: number;
}): MustDoFit {
  const neededMin = args.tasks.reduce((n, t) => n + Math.max(0, t.minutes), 0);
  const windowMin = plannableMinutes(args.windows, args.cuts);
  const availableMin = Math.min(windowMin, Math.max(0, args.dailyCapMin));
  const shortfallMin = Math.max(0, neededMin - availableMin);
  return {
    fits: shortfallMin === 0,
    neededMin,
    availableMin,
    shortfallMin,
    tasks: args.tasks,
  };
}

const hhmm = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${String(m).padStart(2, "0")}`;
  if (h) return `${h}h`;
  return `${m}m`;
};

/** The message the user sees when the must-do set cannot fit. Names names. */
export function mustDoFailureMessage(fit: MustDoFit): string {
  const list = fit.tasks.map((t) => `${t.title} (${hhmm(t.minutes)})`).join(", ");
  return (
    `Your must-do-today tasks need ${hhmm(fit.neededMin)} but only ` +
    `${hhmm(fit.availableMin)} is left today — ${hhmm(fit.shortfallMin)} short. ` +
    `Must-do: ${list}. ` +
    `Nothing was planned: drop a must-do flag, shrink an estimate, or extend ` +
    `today's working window, then plan again.`
  );
}

/** Thrown by compose rather than quietly deferring a must-do task. */
export class MustDoOverflowError extends Error {
  readonly code = "MUST_DO_OVERFLOW";
  constructor(readonly fit: MustDoFit) {
    super(mustDoFailureMessage(fit));
    this.name = "MustDoOverflowError";
  }
}
