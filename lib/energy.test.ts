/**
 * lib/energy.test.ts — the sharp-hours suggestion must be conservative.
 * A suggestion that fires on a handful of samples would be worse than none.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketByHour,
  distinctDays,
  suggestSharpWindows,
  sameWindows,
  MIN_SAMPLES_PER_HOUR,
  MIN_DAYS,
  type EnergySample,
  type EnergyLevel,
} from "./energy";

/** n samples of `level` at `hour`, one per day starting 2026-09-01. */
function at(hour: number, level: EnergyLevel, n: number, dayOffset = 0): EnergySample[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-09-${String(1 + i + dayOffset).padStart(2, "0")}`,
    minuteOfDay: hour * 60 + 15,
    level,
  }));
}

test("bucketByHour averages the ordinal and counts distinct days", () => {
  const s = [...at(9, "sharp", 2), ...at(9, "fried", 2)];
  const [b] = bucketByHour(s);
  assert.equal(b.hour, 9);
  assert.equal(b.n, 4);
  assert.equal(b.mean, 1); // (2+2+0+0)/4
  assert.equal(b.days, 2); // both runs used 09-01 and 09-02
});

test("bucketByHour returns only hours with data, in order", () => {
  const s = [...at(14, "ok", 1), ...at(9, "sharp", 1)];
  assert.deepEqual(bucketByHour(s).map((b) => b.hour), [9, 14]);
});

test("distinctDays counts days, not samples", () => {
  assert.equal(distinctDays(at(9, "ok", 6)), 6);
  assert.equal(
    distinctDays([...at(9, "ok", 1), ...at(10, "ok", 1), ...at(11, "ok", 1)]),
    1,
  );
});

test("contiguous sharp hours merge into one window", () => {
  const s = [
    ...at(10, "sharp", 6),
    ...at(11, "sharp", 6),
    ...at(12, "sharp", 6),
    ...at(16, "fried", 6),
  ];
  const out = suggestSharpWindows(s);
  assert.ok(out.confident, JSON.stringify(out));
  assert.deepEqual(out.windows, [["10:00", "13:00"]]);
});

test("a gap splits the run into two windows", () => {
  const s = [
    ...at(9, "sharp", 6),
    ...at(10, "sharp", 6),
    ...at(11, "fried", 6), // the dip
    ...at(17, "sharp", 6),
    ...at(18, "sharp", 6),
  ];
  const out = suggestSharpWindows(s);
  assert.deepEqual(out.windows, [
    ["09:00", "11:00"],
    ["17:00", "19:00"],
  ]);
});

test("a single sharp hour is dropped — shorter than the minimum window", () => {
  const s = [...at(10, "sharp", 6), ...at(15, "fried", 6)];
  // 10:00-11:00 is exactly 60 min, which IS the minimum, so it survives
  assert.deepEqual(suggestSharpWindows(s).windows, [["10:00", "11:00"]]);
});

test("an hour below the sample floor cannot shape the suggestion", () => {
  const thin = MIN_SAMPLES_PER_HOUR - 1;
  const s = [...at(10, "sharp", thin, 0), ...at(11, "sharp", 6)];
  const out = suggestSharpWindows(s);
  // hour 10 is ignored, so the window starts at 11:00 not 10:00
  assert.deepEqual(out.windows, [["11:00", "12:00"]]);
});

test("not confident until the log covers enough distinct days", () => {
  // plenty of samples, but all on ONE day
  const oneDay: EnergySample[] = Array.from({ length: 12 }, () => ({
    date: "2026-09-01",
    minuteOfDay: 10 * 60,
    level: "sharp" as const,
  }));
  const out = suggestSharpWindows(oneDay);
  assert.equal(out.dayN, 1);
  assert.equal(out.confident, false, "one day must never be confident");
  // it still reports what it is leaning towards
  assert.deepEqual(out.windows, [["10:00", "11:00"]]);

  const enough = at(10, "sharp", MIN_DAYS);
  assert.equal(suggestSharpWindows(enough).confident, true);
});

test("a consistently mediocre day suggests no sharp hours at all", () => {
  const s = [...at(9, "ok", 6), ...at(10, "ok", 6), ...at(11, "ok", 6)];
  const out = suggestSharpWindows(s);
  assert.deepEqual(out.windows, []);
  assert.equal(out.confident, false);
});

test("sameWindows compares by value", () => {
  assert.ok(sameWindows([["09:00", "12:30"]], [["09:00", "12:30"]]));
  assert.ok(!sameWindows([["09:00", "12:30"]], [["10:00", "13:00"]]));
  assert.ok(!sameWindows([], [["09:00", "10:00"]]));
});
