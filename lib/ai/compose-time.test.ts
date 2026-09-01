/**
 * lib/ai/compose-time.test.ts — composing mid-day must not schedule into hours
 * that have already gone. The model is told this, but the check below is what
 * actually holds; mirrors the replanFrom rule rebalance already enforces.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { clipFrom } from "@/lib/time";
import { validatePlan } from "./validate";
import type { ComposeInput } from "./compose-types";
import type { PlanResult } from "./schemas";

const base = (planFromMin: number): ComposeInput => ({
  date: "2026-09-01",
  now: "2026-09-01T09:30:00.000Z",
  planFromMin,
  timezone: "Asia/Kolkata",
  workWindows: clipFrom(
    [
      ["09:00", "13:00"],
      ["14:00", "20:00"],
    ],
    planFromMin,
  ),
  sharpHours: [],
  dailyCapMin: 600,
  minBlockMin: 30,
  maxBlockMin: 150,
  breakMin: 15,
  protectedBlocks: [],
  commitments: [],
  habitsDue: [],
  tasks: [{
    id: "11111111-1111-1111-1111-111111111111",
    title: "the task",
    bucket: null,
    category: "deep",
    rawEstimateMin: 60,
    calibratedEstimateMin: 60,
    dueAt: null,
    priority: "normal",
    deferCount: 0,
    mustDoToday: false,
  }],
  calibration: [],
});

const planAt = (start: string, end: string): PlanResult => ({
  blocks: [{
    taskId: "11111111-1111-1111-1111-111111111111",
    title: "the task",
    start,
    end,
    kind: "task",
    category: "deep",
    estimateMin: 60,
    reason: "because",
  }],
  overflow: [],
  calibrationNote: null,
});

test("clipFrom trims the part of a window that has already passed", () => {
  assert.deepEqual(
    clipFrom([["09:00", "13:00"], ["14:00", "20:00"]], 15 * 60),
    [["15:00", "20:00"]],
  );
});

test("clipFrom drops a window that is entirely in the past", () => {
  assert.deepEqual(clipFrom([["09:00", "13:00"]], 15 * 60), []);
});

test("composing at 15:00 rejects a block placed at 09:00", () => {
  const v = validatePlan(planAt("09:00", "10:00"), base(15 * 60));
  assert.ok(
    v.some((m) => /before the earliest plannable time/.test(m)),
    v.join("; "),
  );
});

test("the same block is fine when planning the day from midnight", () => {
  assert.deepEqual(validatePlan(planAt("09:00", "10:00"), base(0)), []);
});

test("composing at 15:00 accepts a block placed at 15:30", () => {
  assert.deepEqual(validatePlan(planAt("15:30", "16:30"), base(15 * 60)), []);
});
