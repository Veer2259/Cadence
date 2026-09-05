import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitEstimate,
  sittingBounds,
  sizeCandidates,
  SITTING_MIN_MIN,
  SITTING_MAX_MIN,
} from "./task-sizing";

/** The shipped day_profile defaults. */
const DEFAULT = { minBlockMin: 30, maxBlockMin: 150 };

test("a single sitting is 30 to 120 minutes", () => {
  assert.equal(SITTING_MIN_MIN, 30);
  assert.equal(SITTING_MAX_MIN, 120);
});

test("the day profile NARROWS the sitting range, it is not overridden by it", () => {
  // max_block_min 90 means 90, not 120.
  assert.deepEqual(sittingBounds({ minBlockMin: 30, maxBlockMin: 90 }), {
    min: 30,
    max: 90,
  });
  // min_block_min 45 means 45, not 30.
  assert.deepEqual(sittingBounds({ minBlockMin: 45, maxBlockMin: 150 }), {
    min: 45,
    max: 120,
  });
});

test("a profile entirely outside 30-120 wins — an unplaceable task is worse", () => {
  // Someone who works in 3-hour blocks minimum.
  assert.deepEqual(sittingBounds({ minBlockMin: 180, maxBlockMin: 240 }), {
    min: 180,
    max: 240,
  });
});

test("a task already inside one sitting is left alone", () => {
  assert.deepEqual(splitEstimate(90, DEFAULT), [90]);
  assert.deepEqual(splitEstimate(120, DEFAULT), [120]);
});

test("a task under the floor is raised to it, not proposed as a stub", () => {
  assert.deepEqual(splitEstimate(10, DEFAULT), [30]);
});

test("anything over one sitting is split into several tasks", () => {
  const parts = splitEstimate(240, DEFAULT);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts, [120, 120]);
});

test("parts are EVEN rather than max-plus-scrap", () => {
  // 150 could be 120 + 30. Two 75s read as two sittings; 120+30 reads as an
  // afterthought.
  assert.deepEqual(splitEstimate(150, DEFAULT), [75, 75]);
});

test("no part is ever left below the floor", () => {
  for (const total of [125, 130, 190, 245, 301, 480]) {
    for (const part of splitEstimate(total, DEFAULT)) {
      assert.ok(part >= 30, `${total} produced a ${part}m part`);
    }
  }
});

test("no part ever exceeds the ceiling", () => {
  for (const total of [121, 150, 240, 300, 700]) {
    for (const part of splitEstimate(total, DEFAULT)) {
      assert.ok(part <= 120, `${total} produced a ${part}m part`);
    }
  }
});

test("a tighter max_block_min produces more, smaller parts", () => {
  const tight = splitEstimate(240, { minBlockMin: 30, maxBlockMin: 60 });
  assert.equal(tight.length, 4);
  for (const p of tight) assert.ok(p <= 60);
});

test("split candidates are labelled so three rows do not look like a repeat", () => {
  const out = sizeCandidates(
    [{ title: "Draft the deck", estimateMin: 300, category: "deep" }],
    DEFAULT,
  );
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((c) => c.title),
    ["Draft the deck (1/3)", "Draft the deck (2/3)", "Draft the deck (3/3)"],
  );
  // fields other than title/estimate survive the split
  assert.ok(out.every((c) => c.category === "deep"));
});

test("an unsplit candidate keeps its title unchanged", () => {
  const out = sizeCandidates([{ title: "Email the mill", estimateMin: 45 }], DEFAULT);
  assert.deepEqual(out, [{ title: "Email the mill", estimateMin: 45 }]);
});
