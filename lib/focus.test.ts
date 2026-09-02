/**
 * lib/focus.test.ts — learned focus hours.
 *
 * The cold start is the case that matters most: with no history there must be
 * NO preferred hours at all. Falling back to a morning assumption is the guess
 * this feature exists to remove.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreHour,
  scoreAllHours,
  preferredHours,
  focusWindows,
  ratioScore,
  usableSample,
  MIN_FOCUS_SAMPLES,
  FOCUS_PREFER_THRESHOLD,
  type FocusSample,
} from "./focus";

const done = (hour: number, est: number, actual: number): FocusSample => ({
  hour,
  rawEstimateMin: est,
  actualMin: actual,
  skipped: false,
});
const skipped = (hour: number, est = 60): FocusSample => ({
  hour,
  rawEstimateMin: est,
  actualMin: null,
  skipped: true,
});

test("ratioScore punishes overrun and is neutral about finishing early", () => {
  assert.equal(ratioScore(1), 1);
  assert.equal(Math.round(ratioScore(1.5) * 100) / 100, 0.67);
  assert.equal(ratioScore(2), 0.5);
  // under estimate is not a problem — it must not be punished
  assert.equal(ratioScore(0.5), 1);
  assert.equal(ratioScore(0.1), 1);
});

test("a sample with a tiny estimate is discarded as noise", () => {
  assert.equal(usableSample(done(9, 10, 12)), false, "raw estimate under 15 min");
  assert.equal(usableSample(done(9, 60, 60)), true);
});

test("a wildly overrun sample is discarded as abandoned, not slow", () => {
  assert.equal(usableSample(done(9, 60, 400)), false, "ratio over 5");
  assert.equal(usableSample(done(9, 60, 300)), true, "ratio exactly 5 is kept");
});

test("a skip is always usable — it is evidence about the slot", () => {
  assert.equal(usableSample(skipped(9)), true);
});

test("an hour where deep work lands on estimate scores near 1", () => {
  const s = scoreHour(10, [done(10, 60, 60), done(10, 60, 62), done(10, 90, 88)]);
  assert.equal(s.confident, true);
  assert.ok(s.score !== null && s.score > 0.95, `got ${s.score}`);
  assert.equal(s.skipRate, 0);
});

test("an hour where deep work overruns badly scores poorly", () => {
  const s = scoreHour(15, [done(15, 60, 120), done(15, 60, 130), done(15, 60, 110)]);
  assert.equal(s.confident, true);
  assert.ok(s.score !== null && s.score < 0.55, `got ${s.score}`);
  assert.ok((s.meanRatio ?? 0) > 1.8);
});

test("skips drag an hour down multiplicatively", () => {
  // work lands on estimate when it happens, but half the time it is skipped
  const s = scoreHour(16, [done(16, 60, 60), done(16, 60, 60), skipped(16), skipped(16)]);
  assert.equal(s.skipRate, 0.5);
  assert.ok(s.score !== null && Math.abs(s.score - 0.5) < 0.01, `got ${s.score}`);
});

test("an hour that is always skipped scores 0 however rare the success", () => {
  const s = scoreHour(7, [skipped(7), skipped(7), skipped(7), skipped(7)]);
  assert.equal(s.skipRate, 1);
  assert.equal(s.score, 0);
});

test("an hour below the sample floor has no score at all", () => {
  const s = scoreHour(11, [done(11, 60, 60), done(11, 60, 60)]);
  assert.equal(s.sampleN, MIN_FOCUS_SAMPLES - 1);
  assert.equal(s.confident, false);
  assert.equal(s.score, null, "no score until there is enough evidence");
});

/* ---------------- the cold start ---------------- */

test("COLD START: no history means NO preferred hours — never a morning default", () => {
  assert.deepEqual(preferredHours([]), []);
  assert.deepEqual(focusWindows(preferredHours([])), []);
});

test("thin history still yields no preferred hours", () => {
  // two good samples in one hour: promising, but under the floor
  const scores = scoreAllHours([done(9, 60, 60), done(9, 60, 58)]);
  assert.equal(scores[0].confident, false);
  assert.deepEqual(preferredHours(scores), []);
});

test("only confident, well-scoring hours are preferred", () => {
  const scores = scoreAllHours([
    ...[0, 1, 2].map(() => done(10, 60, 60)), // good, confident
    ...[0, 1, 2].map(() => done(15, 60, 150)), // bad, confident
    done(20, 60, 60), // good but only one sample
  ]);
  assert.deepEqual(
    preferredHours(scores).map((p) => p.hour),
    [10],
  );
});

/* ---------------- manual override ---------------- */

test("a manual override wins over the learned score", () => {
  const scores = scoreAllHours([...[0, 1, 2].map(() => done(15, 60, 150))]); // 15 scores badly
  assert.deepEqual(preferredHours(scores).map((p) => p.hour), []);

  const withOverride = preferredHours(scores, new Map([[15, 0.9]]));
  assert.deepEqual(withOverride, [{ hour: 15, score: 0.9, manual: true }]);
});

test("an override can also REMOVE a well-scoring hour", () => {
  const scores = scoreAllHours([...[0, 1, 2].map(() => done(10, 60, 60))]);
  assert.deepEqual(preferredHours(scores).map((p) => p.hour), [10]);
  // the person says 10:00 is actually terrible
  assert.deepEqual(preferredHours(scores, new Map([[10, 0]])), []);
});

test("an override applies even to an hour with no data at all", () => {
  assert.deepEqual(
    preferredHours([], new Map([[22, 0.8]])),
    [{ hour: 22, score: 0.8, manual: true }],
  );
});

/* ---------------- windows ---------------- */

test("contiguous preferred hours merge into windows", () => {
  const pref = [10, 11, 12, 17].map((h) => ({ hour: h, score: 0.9, manual: false }));
  assert.deepEqual(focusWindows(pref), [
    ["10:00", "13:00"],
    ["17:00", "18:00"],
  ]);
});

test("the prefer threshold is the documented one", () => {
  const scores = scoreAllHours([...[0, 1, 2].map(() => done(12, 60, 60))]);
  const s = scores[0].score as number;
  assert.ok(s >= FOCUS_PREFER_THRESHOLD);
});
