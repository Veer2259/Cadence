import { test } from "node:test";
import assert from "node:assert/strict";
import { streakEndingYesterday, longestStreak, recentDays } from "./streak";

test("streakEndingYesterday counts back from yesterday, not today", () => {
  // today is closed but yesterday is not: the run ending yesterday is 0.
  assert.equal(streakEndingYesterday(["2026-09-03"], "2026-09-03"), 0);
});

test("streakEndingYesterday ignores whether today is closed", () => {
  const closed = ["2026-09-01", "2026-09-02"];
  assert.equal(streakEndingYesterday(closed, "2026-09-03"), 2);
  // closing today as well must not change yesterday's run
  assert.equal(streakEndingYesterday([...closed, "2026-09-03"], "2026-09-03"), 2);
});

test("streakEndingYesterday stops at the first gap", () => {
  const closed = ["2026-08-29", "2026-08-31", "2026-09-01", "2026-09-02"];
  assert.equal(streakEndingYesterday(closed, "2026-09-03"), 3); // 30th is missing
});

test("streakEndingYesterday crosses a month boundary", () => {
  const closed = ["2026-08-30", "2026-08-31", "2026-09-01"];
  assert.equal(streakEndingYesterday(closed, "2026-09-02"), 3);
});

test("streakEndingYesterday is 0 with no history", () => {
  assert.equal(streakEndingYesterday([], "2026-09-03"), 0);
});

test("longestStreak finds the best run, not the current one", () => {
  const closed = [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", // run of 4
    "2026-09-01", "2026-09-02", // run of 2, the current one
  ];
  assert.equal(longestStreak(closed), 4);
  assert.equal(streakEndingYesterday(closed, "2026-09-03"), 2);
});

test("longestStreak counts each run once regardless of set order", () => {
  const closed = ["2026-09-02", "2026-08-31", "2026-09-01"];
  assert.equal(longestStreak(closed), 3);
});

test("longestStreak is 0 with no history", () => {
  assert.equal(longestStreak([]), 0);
});

test("recentDays returns seven days ending yesterday, oldest first", () => {
  const days = recentDays(["2026-09-01", "2026-09-02"], "2026-09-03");
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-08-27");
  assert.equal(days[6].date, "2026-09-02");
  assert.deepEqual(
    days.map((d) => d.closed),
    [false, false, false, false, false, true, true],
  );
});

test("recentDays never includes today", () => {
  const days = recentDays(["2026-09-03"], "2026-09-03");
  assert.ok(days.every((d) => d.date !== "2026-09-03"));
  assert.ok(days.every((d) => !d.closed));
});
