/**
 * lib/energy.test.ts — the sharp-hours suggestion must be conservative.
 * A suggestion that fires on a handful of samples would be worse than none.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketByHour,
  distinctDays,
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







