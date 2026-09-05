/**
 * lib/plan-invariant.test.ts
 *
 * A task once left a plan with no block, no overflow row and nothing in the UI.
 * With twenty tasks in flight that is invisible, so these cases are the ones
 * that must never regress — especially the assistant-edit path, which is the
 * one that actually lost it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUnaccountedTasks,
  assertTasksAccountedFor,
  PlanAccountingError,
  type TaskRef,
} from "./plan-invariant";

const T = (id: string, title = id): TaskRef => ({ id, title });

test("a task scheduled as a block is accounted for", () => {
  assert.deepEqual(
    findUnaccountedTasks({
      inputTasks: [T("a")],
      blockTaskIds: ["a"],
      overflowTaskIds: [],
    }),
    [],
  );
});

test("a task recorded in overflow is accounted for", () => {
  assert.deepEqual(
    findUnaccountedTasks({
      inputTasks: [T("a")],
      blockTaskIds: [],
      overflowTaskIds: ["a"],
    }),
    [],
  );
});

test("a task in NEITHER is reported — the bug that shipped", () => {
  const lost = findUnaccountedTasks({
    inputTasks: [T("a", "start work on CV"), T("b", "Samagra")],
    blockTaskIds: ["b"],
    overflowTaskIds: [],
  });
  assert.equal(lost.length, 1);
  assert.equal(lost[0].title, "start work on CV");
});

test("null taskIds (habit / break / fixed blocks) never mask a lost task", () => {
  const lost = findUnaccountedTasks({
    inputTasks: [T("a", "the task")],
    // a plan full of habit and break blocks, none carrying a task id
    blockTaskIds: [null, null, null],
    overflowTaskIds: [],
  });
  assert.equal(lost.length, 1, "a plan of habits must not look like it covered a task");
});

test("assert throws with every lost task named", () => {
  assert.throws(
    () =>
      assertTasksAccountedFor({
        inputTasks: [T("a", "write the brief"), T("b", "call the mill")],
        blockTaskIds: [],
        overflowTaskIds: [],
      }),
    (e: unknown) => {
      assert.ok(e instanceof PlanAccountingError);
      assert.equal(e.lost.length, 2);
      assert.match(e.message, /write the brief/);
      assert.match(e.message, /call the mill/);
      assert.match(e.message, /Nothing was saved/);
      return true;
    },
  );
});

test("assert passes silently when everything is covered", () => {
  assert.doesNotThrow(() =>
    assertTasksAccountedFor({
      inputTasks: [T("a"), T("b")],
      blockTaskIds: ["a"],
      overflowTaskIds: ["b"],
    }),
  );
});

/* ---- the assistant-edit path, modelled step by step ---- */

test("assistant DROP without an overflow row loses the task", () => {
  // the plan as it was: two tasks, both scheduled
  const input = [T("cv", "start work on CV"), T("sam", "Samagra")];
  let blockIds = ["cv", "sam"];
  const overflowIds: string[] = [];
  assert.deepEqual(findUnaccountedTasks({ inputTasks: input, blockTaskIds: blockIds, overflowTaskIds: overflowIds }), []);

  // the assistant drops the CV block to make room — the OLD behaviour
  blockIds = blockIds.filter((b) => b !== "cv");
  const lost = findUnaccountedTasks({ inputTasks: input, blockTaskIds: blockIds, overflowTaskIds: overflowIds });
  assert.equal(lost.length, 1);
  assert.equal(lost[0].title, "start work on CV", "this is exactly what vanished");
});

test("assistant DROP that writes an overflow row keeps the task accounted for", () => {
  const input = [T("cv", "start work on CV"), T("sam", "Samagra")];
  const blockIds = ["sam"];
  const overflowIds = ["cv"]; // the fix: dropping writes a row
  assert.deepEqual(
    findUnaccountedTasks({ inputTasks: input, blockTaskIds: blockIds, overflowTaskIds: overflowIds }),
    [],
  );
});

test("a task moved rather than dropped stays accounted for", () => {
  // move/resize never removes a block, so the set is unchanged
  const input = [T("a"), T("b")];
  assert.deepEqual(
    findUnaccountedTasks({ inputTasks: input, blockTaskIds: ["a", "b"], overflowTaskIds: [] }),
    [],
  );
});

test("a task with two blocks stays accounted for when only one is dropped", () => {
  const input = [T("a", "split task")];
  // it had two sittings; dropping one leaves the other
  assert.deepEqual(
    findUnaccountedTasks({ inputTasks: input, blockTaskIds: ["a"], overflowTaskIds: [] }),
    [],
  );
});

test("a plan built from open blocks only loses what an earlier one deferred", () => {
  // an earlier plan deferred CV; the next was built from open blocks only
  const parentInput = [T("cv", "start work on CV"), T("sam", "Samagra")];
  const childBlocks = ["sam"];
  const childOverflowWithoutCarry: string[] = [];
  assert.equal(
    findUnaccountedTasks({
      inputTasks: parentInput,
      blockTaskIds: childBlocks,
      overflowTaskIds: childOverflowWithoutCarry,
    }).length,
    1,
  );

  // carrying the parent's overflow forward fixes it
  assert.deepEqual(
    findUnaccountedTasks({
      inputTasks: parentInput,
      blockTaskIds: childBlocks,
      overflowTaskIds: ["cv"],
    }),
    [],
  );
});
