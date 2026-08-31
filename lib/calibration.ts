/**
 * lib/calibration.ts — the compounding feature. SPEC section 4.
 *
 * Recording (at debrief): for a done/partial block with a non-null actual_min,
 *   sample = actual_min / raw_estimate_min
 * Discard if raw_estimate_min < 15 (noise) or sample > 5 (block abandoned/misused).
 *
 * Updating: exponentially weighted, alpha = 0.3
 *   new_ratio = alpha * sample + (1 - alpha) * old_ratio
 * First sight of a scope key seeds ratio = 1.0, sample_n = 0; sample_n += 1 each update.
 *
 * Applying (at compose):
 *   if sample_n >= 3:  calibrated = round(raw * clamp(ratio, 0.6, 2.5))
 *   else:              calibrated = raw
 */

export type CategoryRatio = { ratio: number; sampleN: number };

const MIN_SAMPLES = 3;
const CLAMP_LO = 0.6;
const CLAMP_HI = 2.5;
export const EWMA_ALPHA = 0.3;
/** Samples outside these bounds are noise and are discarded, not recorded. */
export const SAMPLE_MIN_RAW_MIN = 15;
export const SAMPLE_MAX_RATIO = 5;
/** SPEC section 4: a difference this large that changed a block must be explained. */
export const MATERIAL_HI = 1.25;
export const MATERIAL_LO = 0.8;

export function clampRatio(ratio: number): number {
  return Math.min(CLAMP_HI, Math.max(CLAMP_LO, ratio));
}

/** The actual/estimate sample for a block, or null if it should be discarded. */
export function sampleFor(
  actualMin: number | null,
  rawEstimateMin: number,
): number | null {
  if (actualMin == null || actualMin <= 0) return null;
  if (rawEstimateMin < SAMPLE_MIN_RAW_MIN) return null;
  const sample = actualMin / rawEstimateMin;
  if (sample > SAMPLE_MAX_RATIO) return null;
  return sample;
}

/** One exponentially-weighted step. `old` defaults to the seed ratio of 1.0. */
export function nextRatio(sample: number, old = 1): number {
  return EWMA_ALPHA * sample + (1 - EWMA_ALPHA) * old;
}

export type CalibrationOutcome = {
  calibratedMin: number;
  applied: boolean;
  /** the clamped ratio actually used (1 when not applied) */
  ratio: number;
};

export function applyCalibration(
  rawEstimateMin: number,
  cal: CategoryRatio | undefined,
): CalibrationOutcome {
  if (!cal || cal.sampleN < MIN_SAMPLES) {
    return { calibratedMin: rawEstimateMin, applied: false, ratio: 1 };
  }
  const ratio = clampRatio(cal.ratio);
  return {
    calibratedMin: Math.round(rawEstimateMin * ratio),
    applied: true,
    ratio,
  };
}

/** True when a calibrated estimate diverged enough from raw that the plan should say so. */
export function isMaterialShift(ratio: number): boolean {
  return ratio >= MATERIAL_HI || ratio <= MATERIAL_LO;
}
