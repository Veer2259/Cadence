/**
 * Unit tests for lib/calibration.ts — SPEC section 4, exactly.
 * Run with:  npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sampleFor,
  nextRatio,
  applyCalibration,
  clampRatio,
  isMaterialShift,
  EWMA_ALPHA,
} from "./calibration";

test("sampleFor discards raw estimates under 15 minutes", () => {
  assert.equal(sampleFor(20, 14), null);
  assert.equal(sampleFor(20, 15), 20 / 15);
});

test("sampleFor discards samples over 5x", () => {
  assert.equal(sampleFor(300, 50), null); // 6x
  assert.equal(sampleFor(250, 50), 5); // exactly 5x is kept
});

test("sampleFor discards missing / zero actuals", () => {
  assert.equal(sampleFor(null, 60), null);
  assert.equal(sampleFor(0, 60), null);
});

test("nextRatio is EWMA with alpha 0.3, seeding old = 1.0", () => {
  assert.equal(EWMA_ALPHA, 0.3);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  // first sample of 2.0 against the seed 1.0
  near(nextRatio(2.0), 1.3);
  // against an accumulated ratio
  near(nextRatio(1.5, 1.3), 0.3 * 1.5 + 0.7 * 1.3);
});

test("a run of consistent over-runs converges toward the true ratio", () => {
  let r = 1;
  for (let i = 0; i < 20; i++) r = nextRatio(1.4, r);
  assert.ok(Math.abs(r - 1.4) < 0.01);
});

test("applyCalibration needs 3 samples before it does anything", () => {
  assert.deepEqual(applyCalibration(60, { ratio: 1.4, sampleN: 2 }), {
    calibratedMin: 60,
    applied: false,
    ratio: 1,
  });
  assert.deepEqual(applyCalibration(60, { ratio: 1.4, sampleN: 3 }), {
    calibratedMin: 84, // round(60 * 1.4)
    applied: true,
    ratio: 1.4,
  });
  assert.deepEqual(applyCalibration(60, undefined), {
    calibratedMin: 60,
    applied: false,
    ratio: 1,
  });
});

test("applyCalibration clamps the ratio to 0.6 .. 2.5", () => {
  assert.equal(clampRatio(0.2), 0.6);
  assert.equal(clampRatio(9), 2.5);
  assert.equal(applyCalibration(100, { ratio: 9, sampleN: 10 }).calibratedMin, 250);
  assert.equal(applyCalibration(100, { ratio: 0.1, sampleN: 10 }).calibratedMin, 60);
});

test("isMaterialShift matches the >= 1.25 / <= 0.8 rule", () => {
  assert.equal(isMaterialShift(1.25), true);
  assert.equal(isMaterialShift(1.24), false);
  assert.equal(isMaterialShift(0.8), true);
  assert.equal(isMaterialShift(0.81), false);
  assert.equal(isMaterialShift(1.0), false);
});
