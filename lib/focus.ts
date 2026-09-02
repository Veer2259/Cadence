/**
 * lib/focus.ts — learned focus hours.
 *
 * Replaces the declared `sharp_hours`. Being asked to predict when you think
 * clearly is a guess, and that guess contradicted the work windows badly enough
 * to defer real work: only 90 minutes of declared sharp time fell inside a
 * working window against 180 minutes of deep work, so a task was deferred with
 * 235 free minutes in the day.
 *
 * So the app stops asking and starts measuring. For deep-category blocks, per
 * hour of day:
 *   - how close actual came to estimate (overrunning badly scores poorly)
 *   - how often that slot gets skipped (a slot you keep skipping is a bad slot)
 *
 * Pure module: no db, no "server-only". The maths is the part worth testing.
 */

/** Same discipline as calibration: nothing is trusted under three samples. */
export const MIN_FOCUS_SAMPLES = 3;

/**
 * Above this an hour is worth preferring for deep work. Below it the hour is
 * still reported on Review — the evidence is the point — but compose is not
 * told to favour it.
 */
export const FOCUS_PREFER_THRESHOLD = 0.6;

export type FocusSample = {
  /** 0..23, IST */
  hour: number;
  /** the block's uncalibrated estimate */
  rawEstimateMin: number;
  /** null when the block was skipped */
  actualMin: number | null;
  skipped: boolean;
};

export type FocusScore = {
  hour: number;
  /** 0..1; higher is better. Null when there is not enough evidence. */
  score: number | null;
  /** mean actual/estimate for deep work in this hour; null when no completions */
  meanRatio: number | null;
  /** 0..1 */
  skipRate: number;
  sampleN: number;
  /** true when sampleN >= MIN_FOCUS_SAMPLES */
  confident: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Is this sample usable? Mirrors lib/calibration.ts: a tiny estimate makes the
 * ratio meaningless, and a wildly large one means the block was abandoned
 * rather than worked.
 */
export function usableSample(s: FocusSample): boolean {
  if (s.skipped) return true; // a skip is evidence about the slot, not the work
  if (s.actualMin == null) return false;
  if (s.rawEstimateMin < 15) return false;
  const ratio = s.actualMin / s.rawEstimateMin;
  return ratio <= 5;
}

/**
 * Overrun penalty. Running UNDER estimate is not a problem — finishing early in
 * a slot says nothing bad about it — so only overrun is punished.
 *   ratio 1.0 -> 1.00   ratio 1.5 -> 0.67   ratio 2.0 -> 0.50   ratio 3.0 -> 0.33
 */
export function ratioScore(meanRatio: number): number {
  return 1 / (1 + Math.max(0, meanRatio - 1));
}

/**
 * Score one hour from its samples.
 *
 * Multiplicative on skip rate, deliberately: an hour whose work is always
 * skipped scores 0 no matter how well the rare completion went.
 */
export function scoreHour(hour: number, samples: FocusSample[]): FocusScore {
  const usable = samples.filter(usableSample);
  const sampleN = usable.length;
  const skips = usable.filter((s) => s.skipped).length;
  const done = usable.filter((s) => !s.skipped && s.actualMin != null);

  const skipRate = sampleN > 0 ? skips / sampleN : 0;
  const meanRatio =
    done.length > 0
      ? done.reduce((n, s) => n + (s.actualMin as number) / s.rawEstimateMin, 0) /
        done.length
      : null;

  const confident = sampleN >= MIN_FOCUS_SAMPLES;
  // No completions at all means no ratio evidence; the skip rate alone still
  // says something, so score on that.
  const base = meanRatio === null ? 1 : ratioScore(meanRatio);
  const score = confident ? round2(base * (1 - skipRate)) : null;

  return {
    hour,
    score,
    meanRatio: meanRatio === null ? null : round2(meanRatio),
    skipRate: round2(skipRate),
    sampleN,
    confident,
  };
}

/** Score every hour that has any samples. Hours with none are simply absent. */
export function scoreAllHours(samples: FocusSample[]): FocusScore[] {
  const byHour = new Map<number, FocusSample[]>();
  for (const s of samples) {
    if (s.hour < 0 || s.hour > 23) continue;
    const arr = byHour.get(s.hour) ?? [];
    arr.push(s);
    byHour.set(s.hour, arr);
  }
  return [...byHour.entries()]
    .map(([hour, list]) => scoreHour(hour, list))
    .sort((a, b) => a.hour - b.hour);
}

export type EffectiveFocus = {
  hour: number;
  score: number;
  /** true when this came from a manual override rather than the data */
  manual: boolean;
};

/**
 * The hours compose should be told to prefer.
 *
 * A manual override always wins — the person can see the evidence on Review and
 * correct it. Otherwise only confident, well-scoring hours qualify. With no
 * history this returns an EMPTY array, and compose is told to say so rather
 * than falling back to a morning assumption: that assumption is the guess this
 * whole feature exists to remove.
 */
export function preferredHours(
  scores: FocusScore[],
  overrides: Map<number, number> = new Map(),
): EffectiveFocus[] {
  const out: EffectiveFocus[] = [];
  for (let h = 0; h < 24; h++) {
    const manual = overrides.get(h);
    if (manual != null) {
      if (manual >= FOCUS_PREFER_THRESHOLD) out.push({ hour: h, score: manual, manual: true });
      continue;
    }
    const s = scores.find((x) => x.hour === h);
    if (s?.confident && s.score != null && s.score >= FOCUS_PREFER_THRESHOLD) {
      out.push({ hour: h, score: s.score, manual: false });
    }
  }
  return out;
}

/** Contiguous preferred hours merged into [start,end) HH:mm windows. */
export function focusWindows(pref: EffectiveFocus[]): [string, string][] {
  const hm = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const hours = pref.map((p) => p.hour).sort((a, b) => a - b);
  const out: [string, string][] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const h of hours) {
    if (start === null) start = h;
    else if (prev !== null && h !== prev + 1) {
      out.push([hm(start), hm(prev + 1)]);
      start = h;
    }
    prev = h;
  }
  if (start !== null && prev !== null) out.push([hm(start), hm(prev + 1)]);
  return out;
}
