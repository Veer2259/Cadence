import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseCadenceText,
  formatCadence,
  habitDaysForWeek,
  isHabitDueOn,
  narrowCadence,
  type HabitCadence,
} from "./habits";
import type { WeekdayKey } from "./time";

const WEEK: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri"];
const FULL: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

test("parseCadenceText understands the shapes a person types", () => {
  assert.deepEqual(parseCadenceText("daily"), { kind: "daily" });
  assert.deepEqual(parseCadenceText("every day"), { kind: "daily" });
  assert.deepEqual(parseCadenceText("5x/week"), { kind: "per_week", count: 5 });
  assert.deepEqual(parseCadenceText("5 times a week"), { kind: "per_week", count: 5 });
  assert.deepEqual(parseCadenceText("3 / week"), { kind: "per_week", count: 3 });
  assert.deepEqual(parseCadenceText("mon,wed,fri"), { kind: "days", days: ["mon", "wed", "fri"] });
  assert.deepEqual(parseCadenceText("Tue Thu"), { kind: "days", days: ["tue", "thu"] });
  assert.deepEqual(parseCadenceText("whenever"), { kind: "per_week", count: 3 });
});

test("per_week count is clamped to 1..7", () => {
  assert.deepEqual(parseCadenceText("0x/week"), { kind: "per_week", count: 1 });
  assert.deepEqual(parseCadenceText("12x/week"), { kind: "per_week", count: 7 });
});

test("narrowCadence coerces junk to a visible default", () => {
  assert.deepEqual(narrowCadence(null), { kind: "per_week", count: 3 });
  assert.deepEqual(narrowCadence("3x/week"), { kind: "per_week", count: 3 });
  assert.deepEqual(narrowCadence({ kind: "days", days: ["mon", "bogus"] }), {
    kind: "days",
    days: ["mon"],
  });
  assert.deepEqual(narrowCadence({ kind: "per_week", count: "4" }), {
    kind: "per_week",
    count: 4,
  });
});

test("formatCadence is human-readable and weekday-ordered", () => {
  assert.equal(formatCadence({ kind: "daily" }), "daily");
  assert.equal(formatCadence({ kind: "per_week", count: 5 }), "5×/week");
  assert.equal(
    formatCadence({ kind: "days", days: ["fri", "mon", "wed"] }),
    "mon, wed, fri",
  );
});

test("5x/week on a Mon-Fri work week lands on all five days", () => {
  const c: HabitCadence = { kind: "per_week", count: 5 };
  assert.deepEqual(habitDaysForWeek(c, WEEK), ["mon", "tue", "wed", "thu", "fri"]);
  for (const d of WEEK) assert.equal(isHabitDueOn(c, d, WEEK), true);
});

test("3x/week on a Mon-Fri work week spreads to Mon / Wed / Fri", () => {
  assert.deepEqual(habitDaysForWeek({ kind: "per_week", count: 3 }, WEEK), [
    "mon",
    "wed",
    "fri",
  ]);
});

test("2x/week spreads to the ends of the working week", () => {
  assert.deepEqual(habitDaysForWeek({ kind: "per_week", count: 2 }, WEEK), ["mon", "fri"]);
});

test("1x/week picks a mid-week day", () => {
  assert.deepEqual(habitDaysForWeek({ kind: "per_week", count: 1 }, WEEK), ["wed"]);
});

test("per_week count above the number of working days means every working day", () => {
  assert.deepEqual(habitDaysForWeek({ kind: "per_week", count: 6 }, WEEK), WEEK);
});

test("specific days are intersected with the working days", () => {
  const c: HabitCadence = { kind: "days", days: ["sat", "wed"] };
  // no Saturday work window configured
  assert.deepEqual(habitDaysForWeek(c, WEEK), ["wed"]);
  assert.equal(isHabitDueOn(c, "sat", WEEK), false);
  assert.equal(isHabitDueOn(c, "wed", WEEK), true);
  // with a 7-day working week, Saturday counts
  assert.deepEqual(habitDaysForWeek(c, FULL), ["wed", "sat"]);
});

test("daily means every working day, and nothing on a non-working day", () => {
  const c: HabitCadence = { kind: "daily" };
  assert.deepEqual(habitDaysForWeek(c, WEEK), WEEK);
  assert.equal(isHabitDueOn(c, "sun", WEEK), false);
});
