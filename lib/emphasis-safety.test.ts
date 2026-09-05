import { test } from "node:test";
import assert from "node:assert/strict";
import { prematureOverflow, workingMinutes } from "./emphasis-safety";
import type { ComposeInput, ComposeTask } from "./ai/compose-types";
import type { PlanResult } from "./ai/schemas";

function task(id: string, min: number, extra: Partial<ComposeTask> = {}): ComposeTask {
  return {
    id,
    title: id,
    bucket: "cv",
    category: "deep",
    rawEstimateMin: min,
    calibratedEstimateMin: min,
    dueAt: null,
    priority: "normal",
    deferCount: 0,
    mustDoToday: false,
    ...extra,
  };
}

function input(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    date: "2026-09-07",
    now: "2026-09-07T04:30:00Z",
    planFromMin: 0,
    timezone: "Asia/Kolkata",
    workWindows: [["09:00", "18:00"]], // 540 minutes
    focusHours: [],
    focusHoursKnown: false,
    dailyCapMin: 600,
    minBlockMin: 30,
    maxBlockMin: 150,
    breakMin: 15,
    protectedBlocks: [],
    commitments: [],
    habitsDue: [],
    tasks: [],
    calibration: [],
    ...over,
  };
}

function plan(over: Partial<PlanResult> = {}): PlanResult {
  return { blocks: [], overflow: [], calibrationNote: null, ...over };
}

const block = (start: string, end: string, taskId: string | null = null) => ({
  taskId,
  title: taskId ?? "block",
  start,
  end,
  kind: "task" as const,
  category: "deep" as const,
  estimateMin: 60,
  reason: "because",
});

test("workingMinutes totals the windows and respects planFromMin", () => {
  assert.equal(workingMinutes(input()), 540);
  assert.equal(workingMinutes(input({ planFromMin: 12 * 60 })), 360);
});

test("EMPHASIS ALONE NEVER PRODUCES OVERFLOW WHILE FREE MINUTES REMAIN", () => {
  // The day leans towards "cv". "case comp" is deferred anyway — with six hours
  // of the working window still unscheduled. This is the sharp-hours bug in its
  // new clothes, and it must be detectable as arithmetic, not opinion.
  const i = input({
    tasks: [task("cv-1", 60), task("case-1", 90)],
    bucketEmphasis: { buckets: ["cv"], note: "CV matters more today" },
  });
  const p = plan({
    blocks: [block("09:00", "10:00", "cv-1")],
    overflow: [
      { taskId: "case-1", reason: "cv came first", action: "defer", suggestion: "tomorrow" },
    ],
  });

  const bad = prematureOverflow(i, p);
  assert.equal(bad.length, 1, "a task deferred with free time must be flagged");
  assert.equal(bad[0].taskId, "case-1");
  assert.equal(bad[0].neededMin, 90);
  assert.equal(bad[0].freeMin, 480);
});

test("emphasis ordering a full day is fine — overflow with no room is correct", () => {
  const i = input({
    workWindows: [["09:00", "11:00"]], // 120 minutes
    tasks: [task("cv-1", 120), task("case-1", 90)],
    bucketEmphasis: { buckets: ["cv"], note: null },
  });
  const p = plan({
    blocks: [block("09:00", "11:00", "cv-1")],
    overflow: [
      { taskId: "case-1", reason: "no hours left", action: "defer", suggestion: "tomorrow" },
    ],
  });
  assert.deepEqual(prematureOverflow(i, p), [], "a genuinely full day may overflow");
});

test("a task larger than the remaining gap is legitimate overflow", () => {
  const i = input({
    workWindows: [["09:00", "10:00"]], // 60 minutes
    tasks: [task("cv-1", 30), task("case-1", 90)],
    bucketEmphasis: { buckets: ["cv"], note: null },
  });
  const p = plan({
    blocks: [block("09:00", "09:30", "cv-1")],
    overflow: [
      { taskId: "case-1", reason: "needs 90, 30 left", action: "defer", suggestion: "tomorrow" },
    ],
  });
  assert.deepEqual(prematureOverflow(i, p), []);
});

test("the detector fires with or without emphasis — it is about free time, not blame", () => {
  const tasks = [task("a", 60), task("b", 60)];
  const p = plan({
    blocks: [block("09:00", "10:00", "a")],
    overflow: [{ taskId: "b", reason: "…", action: "defer", suggestion: "…" }],
  });
  assert.equal(prematureOverflow(input({ tasks }), p).length, 1);
  assert.equal(
    prematureOverflow(input({ tasks, bucketEmphasis: { buckets: ["cv"], note: null } }), p).length,
    1,
  );
});
