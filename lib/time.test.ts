/**
 * Unit tests for lib/time.ts — run with:  npm test
 *
 * SPEC note 618: get the work-window math right, with tests, before building
 * scheduling on top of it. IST is DST-free so these assertions are stable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  istDateString,
  istTimeString,
  istWeekdayKey,
  hmToMinutes,
  minutesToHm,
  toIntervals,
  overlaps,
  mergeIntervals,
  sumIntervals,
  subtractIntervals,
  windowMinutesForWeekday,
  validateWeeklyWindows,
} from "./time";

test("istDateString / istTimeString convert UTC to the IST wall clock", () => {
  // 2026-08-31T20:00:00Z is 2026-09-01 01:30 IST (UTC+5:30) — crosses the date line
  const utc = new Date("2026-08-31T20:00:00Z");
  assert.equal(istDateString(utc), "2026-09-01");
  assert.equal(istTimeString(utc), "01:30");
});

test("istWeekdayKey uses the IST calendar day", () => {
  // Sunday 23:00 UTC is Monday 04:30 IST
  assert.equal(istWeekdayKey(new Date("2026-08-30T23:00:00Z")), "mon");
  assert.equal(istWeekdayKey(new Date("2026-08-31T06:00:00Z")), "mon");
});

test("hmToMinutes / minutesToHm round-trip", () => {
  assert.equal(hmToMinutes("00:00"), 0);
  assert.equal(hmToMinutes("09:30"), 570);
  assert.equal(hmToMinutes("24:00"), 1440);
  assert.equal(minutesToHm(570), "09:30");
  assert.equal(minutesToHm(0), "00:00");
  assert.throws(() => hmToMinutes("9:30"));
  assert.throws(() => hmToMinutes("25:00"));
  assert.throws(() => hmToMinutes("12:75"));
});

test("toIntervals rejects a zero or negative window", () => {
  assert.throws(() => toIntervals([["10:00", "10:00"]]));
  assert.throws(() => toIntervals([["12:00", "09:00"]]));
});

test("overlaps is half-open (touching edges do not overlap)", () => {
  assert.equal(overlaps({ start: 60, end: 120 }, { start: 120, end: 180 }), false);
  assert.equal(overlaps({ start: 60, end: 121 }, { start: 120, end: 180 }), true);
});

test("mergeIntervals merges overlapping and adjacent runs", () => {
  const merged = mergeIntervals([
    { start: 0, end: 60 },
    { start: 60, end: 90 },
    { start: 200, end: 240 },
    { start: 30, end: 50 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 90 },
    { start: 200, end: 240 },
  ]);
});

test("sumIntervals counts overlapping time once", () => {
  assert.equal(
    sumIntervals([
      { start: 0, end: 120 },
      { start: 60, end: 180 },
    ]),
    180,
  );
});

test("subtractIntervals removes commitments from a work window", () => {
  const work = toIntervals([["09:00", "19:00"]]); // 540..1140
  const busy = toIntervals([
    ["10:00", "11:00"],
    ["13:00", "14:00"],
  ]);
  const free = subtractIntervals(work, busy);
  assert.deepEqual(free, [
    { start: 540, end: 600 }, // 09:00-10:00
    { start: 660, end: 780 }, // 11:00-13:00
    { start: 840, end: 1140 }, // 14:00-19:00
  ]);
  assert.equal(sumIntervals(free), 480); // 10h window - 2h busy = 8h
});

test("subtractIntervals handles a cut that spans a whole piece and split days", () => {
  const work = toIntervals([
    ["09:00", "13:00"],
    ["14:00", "20:00"],
  ]);
  const busy = toIntervals([["08:00", "21:00"]]);
  assert.deepEqual(subtractIntervals(work, busy), []);
});

test("windowMinutesForWeekday sums a split day", () => {
  const weekly = {
    mon: [
      ["09:00", "13:00"],
      ["14:00", "20:00"],
    ] as [string, string][],
  };
  assert.equal(windowMinutesForWeekday(weekly, "mon"), 600); // 4h + 6h
  assert.equal(windowMinutesForWeekday(weekly, "tue"), 0);
});

test("validateWeeklyWindows flags overlaps and bad times", () => {
  assert.deepEqual(validateWeeklyWindows({ mon: [["09:00", "12:00"]] }), []);
  assert.deepEqual(
    validateWeeklyWindows({
      mon: [
        ["09:00", "12:00"],
        ["11:00", "13:00"],
      ],
    }),
    ["mon: windows overlap"],
  );
  assert.equal(validateWeeklyWindows({ tue: [["bad", "12:00"]] }).length, 1);
});
