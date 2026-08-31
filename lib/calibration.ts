/**
 * lib/calibration.ts — apply accumulated actual/estimate ratios to a raw estimate.
 * SPEC section 4 ("Applying"):
 *
 *   if sample_n >= 3:
 *       calibrated = round(raw_estimate * clamp(ratio, 0.6, 2.5))
 *   else:
 *       calibrated = raw_estimate
 */

export type CategoryRatio = { ratio: number; sampleN: number };

const MIN_SAMPLES = 3;
const CLAMP_LO = 0.6;
const CLAMP_HI = 2.5;
/** SPEC section 4: a difference this large that changed a block must be explained. */
export const MATERIAL_HI = 1.25;
export const MATERIAL_LO = 0.8;

export function clampRatio(ratio: number): number {
  return Math.min(CLAMP_HI, Math.max(CLAMP_LO, ratio));
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
