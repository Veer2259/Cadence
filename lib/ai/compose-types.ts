/**
 * The compose input payload — the exact object sent to the model and stored in
 * plans.input_snapshot. Shape follows SPEC section 6.1.
 */

export type ComposeTask = {
  id: string;
  title: string;
  bucket: string | null;
  category: string;
  rawEstimateMin: number;
  calibratedEstimateMin: number;
  dueAt: string | null; // ISO
  priority: "low" | "normal" | "high";
  deferCount: number;
  /**
   * Hard constraint. A task with this set CANNOT be placed in `overflow` —
   * compose refuses the plan instead. Separate from priority, which only ranks.
   */
  mustDoToday: boolean;
  /** Present only when calibration was applied AND the shift is material
   *  (ratio >= 1.25 or <= 0.8). The planner must name this in the block reason. */
  calibration?: {
    category: string;
    ratio: number;
    /** signed percentage the calibrated estimate moved vs. the raw one */
    deltaPct: number;
    sampleN: number;
  };
};

export type ComposeCommitment = { title: string; start: string; end: string };
export type ComposeProtected = { label: string; start: string; end: string };
export type ComposeHabit = {
  id: string;
  name: string;
  durationMin: number;
  preferredWindow: string | null;
};
export type ComposeCalibration = {
  category: string;
  ratio: number;
  sampleN: number;
};

export type ComposeInput = {
  date: string; // IST YYYY-MM-DD
  now: string; // ISO
  /**
   * Earliest HH:mm anything may be scheduled at. "00:00" for a future date;
   * the current IST time when composing today, so a plan built at 15:00 cannot
   * put a block at 09:00. Enforced in lib/ai/validate.ts, not just prompted.
   */
  planFromMin: number;
  timezone: string;
  workWindows: [string, string][];
  sharpHours: [string, string][];
  dailyCapMin: number;
  minBlockMin: number;
  maxBlockMin: number;
  breakMin: number;
  protectedBlocks: ComposeProtected[];
  commitments: ComposeCommitment[];
  habitsDue: ComposeHabit[];
  tasks: ComposeTask[];
  calibration: ComposeCalibration[];
};
