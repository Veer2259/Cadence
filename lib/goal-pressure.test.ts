/**
 * lib/goal-pressure.test.ts — "behind" has to mean something specific before
 * compose is allowed to act on it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { goalPressure, expectedFraction } from "./goal-pressure";

const base = { targetHours: null, actualHours: 0, totalTasks: 0, doneTasks: 0, dayIndexInWeek: 3 };

test("expectedFraction runs from nothing on Monday to all of it by Sunday", () => {
  assert.equal(expectedFraction(0), 0);
  assert.equal(expectedFraction(3), 0.5);
  assert.equal(expectedFraction(6), 1);
  assert.equal(expectedFraction(-2), 0, "clamped");
  assert.equal(expectedFraction(99), 1, "clamped");
});

test("a target with neither hours nor tasks says nothing", () => {
  const g = goalPressure(base);
  assert.equal(g.note, null);
  assert.equal(g.behindBy, 0);
});

test("hours ahead of pace is not flagged", () => {
  const g = goalPressure({ ...base, targetHours: 10, actualHours: 8, dayIndexInWeek: 3 });
  assert.equal(g.state, "ahead");
  assert.equal(g.note, null);
});

test("hours behind pace reports the gap with real numbers", () => {
  // Thursday (index 3) = half the week gone, but only 1h of 10h done
  const g = goalPressure({ ...base, targetHours: 10, actualHours: 1, dayIndexInWeek: 3 });
  assert.equal(g.state, "behind");
  assert.match(g.note ?? "", /1h of 10h/);
  assert.match(g.note ?? "", /50% of the week gone/);
  assert.match(g.note ?? "", /40 points behind/);
});

test("a small gap is slipping, not behind", () => {
  const g = goalPressure({ ...base, targetHours: 10, actualHours: 4, dayIndexInWeek: 3 });
  assert.equal(g.state, "slipping");
});

test("a target without hours falls back to task completion", () => {
  const g = goalPressure({ ...base, totalTasks: 4, doneTasks: 0, dayIndexInWeek: 6 });
  assert.equal(g.state, "behind");
  assert.match(g.note ?? "", /0 of 4 tasks/);
});

test("hours win over task counts when both are present", () => {
  const g = goalPressure({
    ...base, targetHours: 10, actualHours: 10, totalTasks: 4, doneTasks: 0, dayIndexInWeek: 6,
  });
  // hours are fully met, so it is on track — if task counts had won it would
  // read "behind" on 0 of 4 with the week gone
  assert.equal(g.state, "on_track");
  assert.equal(g.note, null);
});

test("Monday expects nothing, so nothing is behind", () => {
  const g = goalPressure({ ...base, targetHours: 10, actualHours: 0, dayIndexInWeek: 0 });
  assert.equal(g.behindBy, 0);
  assert.equal(g.note, null);
});
