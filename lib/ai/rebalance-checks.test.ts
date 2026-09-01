/**
 * lib/ai/rebalance-checks.test.ts — the guard that must be exactly right:
 * a done/partial block is never moved or dropped by a rebalance (SPEC 6.3).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRebalance, preservedIntact, clipFrom, hm } from "./rebalance-checks";
import type { PlanBlock, PlanResult } from "./schemas";
import type { ComposeInput } from "./compose-types";

const preserved: PlanBlock[] = [
  {
    taskId: "t-done",
    title: "morning deep work",
    start: "09:00",
    end: "11:00",
    kind: "task",
    category: "deep",
    estimateMin: 120,
    reason: "already done",
  },
];

const ctxBase = {
  preservedPlanBlocks: preserved,
  replanFromMin: hm("13:00"),
  energy: "sharp" as const,
  completedTaskIds: new Set(["t-done"]),
  fullDayContext: {
    date: "2026-09-01",
    now: "2026-09-01T07:30:00Z",
  planFromMin: 0,
    timezone: "Asia/Kolkata",
    workWindows: [["09:00", "13:00"], ["14:00", "20:00"]],
    sharpHours: [["09:00", "12:30"]],
    dailyCapMin: 600,
    minBlockMin: 30,
    maxBlockMin: 150,
    breakMin: 15,
    protectedBlocks: [{ label: "lunch", start: "13:00", end: "14:00" }],
    commitments: [],
    habitsDue: [],
    tasks: [
      { id: "t-done", title: "morning deep work", bucket: null, category: "deep", rawEstimateMin: 120, calibratedEstimateMin: 120, dueAt: null, priority: "normal" as const, deferCount: 0, mustDoToday: false },
      { id: "t-next", title: "afternoon calls", bucket: null, category: "calls", rawEstimateMin: 40, calibratedEstimateMin: 40, dueAt: null, priority: "normal" as const, deferCount: 0, mustDoToday: false },
    ],
    calibration: [],
  } satisfies ComposeInput,
};

function plan(blocks: PlanBlock[]): PlanResult {
  return { blocks, overflow: [], calibrationNote: null };
}

test("a clean rebalance for the remaining window passes", () => {
  const p = plan([
    { taskId: "t-next", title: "afternoon calls", start: "14:00", end: "14:40", kind: "task", category: "calls", estimateMin: 40, reason: "remaining calls" },
  ]);
  assert.deepEqual(checkRebalance(p, ctxBase), []);
});

test("flags a new block that overlaps the completed morning block", () => {
  const p = plan([
    { taskId: "t-next", title: "afternoon calls", start: "10:30", end: "11:10", kind: "task", category: "calls", estimateMin: 40, reason: "x" },
  ]);
  const v = checkRebalance(p, ctxBase);
  assert.ok(v.some((m) => /overlaps the completed block/.test(m)), v.join("; "));
});

test("flags a new block placed before the replan time", () => {
  const p = plan([
    { taskId: "t-next", title: "afternoon calls", start: "12:00", end: "12:40", kind: "task", category: "calls", estimateMin: 40, reason: "x" },
  ]);
  const v = checkRebalance(p, ctxBase);
  assert.ok(v.some((m) => /before the replan time/.test(m)), v.join("; "));
});

test("flags a new block that re-plans an already-done task", () => {
  const p = plan([
    { taskId: "t-done", title: "morning deep work", start: "14:00", end: "15:00", kind: "task", category: "deep", estimateMin: 60, reason: "x" },
  ]);
  const v = checkRebalance(p, ctxBase);
  assert.ok(v.some((m) => /already done/.test(m)), v.join("; "));
});

test('energy "fried" forbids any new deep block', () => {
  const p = plan([
    { taskId: "t-next", title: "deep thing", start: "14:00", end: "15:00", kind: "task", category: "deep", estimateMin: 60, reason: "x" },
  ]);
  const v = checkRebalance(p, { ...ctxBase, energy: "fried" });
  assert.ok(v.some((m) => /energy is "fried"/.test(m)), v.join("; "));
});

test("preservedIntact is false when a preserved block is missing or moved", () => {
  assert.equal(preservedIntact(preserved, preserved), true);
  assert.equal(preservedIntact(preserved, []), false);
  const moved: PlanBlock[] = [{ ...preserved[0], start: "09:30" }];
  assert.equal(preservedIntact(preserved, moved), false);
});

test("checkRebalance's combined plan always still contains the preserved block", () => {
  // Even a wild model output cannot remove the preserved block, because the app
  // concatenates it back in before validating.
  const wild = plan([
    { taskId: null, title: "chaos", start: "15:00", end: "16:00", kind: "task", category: "shallow", estimateMin: 60, reason: "x" },
  ]);
  const v = checkRebalance(wild, ctxBase);
  // no "moved or dropped" violation — the preserved block is intact by construction
  assert.ok(!v.some((m) => /moved or dropped/.test(m)), v.join("; "));
});

test("clipFrom trims windows to start no earlier than the replan time", () => {
  assert.deepEqual(
    clipFrom([["09:00", "13:00"], ["14:00", "20:00"]], hm("15:30")),
    [["15:30", "20:00"]],
  );
  assert.deepEqual(clipFrom([["09:00", "13:00"]], hm("13:00")), []);
});
