/**
 * lib/must-do.test.ts — a must-do task must never be quietly deferred. The
 * arithmetic that decides "these genuinely do not fit" lives in code, so it is
 * worth pinning precisely.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkMustDoFit,
  plannableMinutes,
  mustDoFailureMessage,
  type MustDoTask,
} from "./must-do";

const T = (title: string, minutes: number): MustDoTask => ({
  id: title,
  title,
  minutes,
});

const DAY: [string, string][] = [
  ["09:00", "13:00"],
  ["14:00", "20:00"],
];

test("plannableMinutes subtracts commitments and protected blocks", () => {
  // 4h + 6h = 600, minus a 1h commitment = 540
  assert.equal(plannableMinutes(DAY, [["10:00", "11:00"]]), 540);
});

test("plannableMinutes counts overlapping cuts only once", () => {
  assert.equal(
    plannableMinutes(DAY, [["10:00", "11:00"], ["10:30", "11:30"]]),
    600 - 90,
  );
});

test("plannableMinutes handles a cut that wraps midnight", () => {
  // sleep 23:30-06:30 does not touch a 09:00-20:00 day
  assert.equal(plannableMinutes(DAY, [["23:30", "06:30"]]), 600);
});

test("a must-do set that fits reports no shortfall", () => {
  const fit = checkMustDoFit({
    tasks: [T("write the brief", 120), T("call the mill", 30)],
    windows: DAY,
    cuts: [],
    dailyCapMin: 600,
  });
  assert.equal(fit.fits, true);
  assert.equal(fit.neededMin, 150);
  assert.equal(fit.shortfallMin, 0);
});

test("a must-do set that overruns the remaining day reports the exact shortfall", () => {
  const fit = checkMustDoFit({
    tasks: [T("write the brief", 300), T("review proposals", 300)],
    windows: [["17:00", "20:00"]], // only 3h left
    cuts: [],
    dailyCapMin: 600,
  });
  assert.equal(fit.fits, false);
  assert.equal(fit.neededMin, 600);
  assert.equal(fit.availableMin, 180);
  assert.equal(fit.shortfallMin, 420);
});

test("the daily cap bounds availability, not just the window length", () => {
  const fit = checkMustDoFit({
    tasks: [T("marathon", 500)],
    windows: DAY, // 600 min of window
    cuts: [],
    dailyCapMin: 240, // but only 4h of cap
  });
  assert.equal(fit.availableMin, 240);
  assert.equal(fit.fits, false);
  assert.equal(fit.shortfallMin, 260);
});

test("no must-do tasks always fits", () => {
  const fit = checkMustDoFit({ tasks: [], windows: [], cuts: [], dailyCapMin: 0 });
  assert.equal(fit.fits, true);
  assert.equal(fit.neededMin, 0);
});

test("the failure message names every task and the shortfall", () => {
  const fit = checkMustDoFit({
    tasks: [T("write the brief", 300), T("call the mill", 30)],
    windows: [["17:00", "20:00"]],
    cuts: [],
    dailyCapMin: 600,
  });
  const msg = mustDoFailureMessage(fit);
  assert.match(msg, /write the brief \(5h\)/);
  assert.match(msg, /call the mill \(30m\)/);
  assert.match(msg, /2h30 short/);
  assert.match(msg, /Nothing was planned/);
});
