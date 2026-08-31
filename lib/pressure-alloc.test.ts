/**
 * lib/pressure-alloc.test.ts — SPEC section 5, step 3. The allocation must not
 * let competing deadlines double-count the same free hours.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateEarliestDueFirst,
  classify,
  type AllocNeed,
} from "./pressure-alloc";

test("classify matches the SPEC ratio bands", () => {
  assert.equal(classify(2.0), "safe");
  assert.equal(classify(1.5), "safe");
  assert.equal(classify(1.49), "tight");
  assert.equal(classify(1.0), "tight");
  assert.equal(classify(0.99), "at_risk");
  assert.equal(classify(0.6), "at_risk");
  assert.equal(classify(0.59), "impossible");
  assert.equal(classify(0), "impossible");
});

test("three tasks due the same day share ONE pool, earliest-listed first", () => {
  // 6 free hours across the 4 days up to Thursday (index 3).
  const free = [2, 2, 1, 1]; // Mon..Thu — prefix at Thu = 6
  const needs: AllocNeed[] = [
    { dueDayIndex: 3, hoursNeeded: 3 }, // A
    { dueDayIndex: 3, hoursNeeded: 3 }, // B
    { dueDayIndex: 3, hoursNeeded: 3 }, // C
  ];
  const [a, b, c] = allocateEarliestDueFirst(needs, free);

  // Total drawable is 6, not 18.
  assert.equal(a.hoursAvailable, 6); // A sees the whole pool
  assert.equal(a.hoursAllocated, 3);
  assert.equal(b.hoursAvailable, 3); // pool minus A's 3
  assert.equal(b.hoursAllocated, 3);
  assert.equal(c.hoursAvailable, 0); // pool exhausted
  assert.equal(c.hoursAllocated, 0);

  assert.equal(a.status, "safe"); // 6/3 = 2.0
  assert.equal(b.status, "tight"); // 3/3 = 1.0
  assert.equal(c.status, "impossible"); // 0/3
});

test("an earlier deadline consumes the pool before a later one sees it", () => {
  const free = [4, 4, 4]; // 12h over 3 days
  const needs: AllocNeed[] = [
    { dueDayIndex: 0, hoursNeeded: 3 }, // due today
    { dueDayIndex: 2, hoursNeeded: 10 }, // due day 3
  ];
  const [today, later] = allocateEarliestDueFirst(needs, free);
  assert.equal(today.hoursAvailable, 4); // today's 4h
  assert.equal(today.hoursAllocated, 3);
  assert.equal(later.hoursAvailable, 9); // 12 total - 3 consumed
  assert.equal(later.status, "at_risk"); // 9/10 = 0.9
});

test("output order matches input order regardless of due dates", () => {
  const free = [3, 3, 3];
  const needs: AllocNeed[] = [
    { dueDayIndex: 2, hoursNeeded: 2 }, // listed first, due later
    { dueDayIndex: 0, hoursNeeded: 2 }, // listed second, due sooner
  ];
  const [first, second] = allocateEarliestDueFirst(needs, free);
  // The sooner one (second in the list) is allocated first internally.
  assert.equal(second.hoursAvailable, 3); // today's pool, untouched
  assert.equal(first.hoursAvailable, 9 - 2); // total 9 minus the sooner one's 2
});

test("a deadline past the horizon still only draws the whole pool once", () => {
  const free = [1, 1];
  const needs: AllocNeed[] = [{ dueDayIndex: 99, hoursNeeded: 5 }];
  const [only] = allocateEarliestDueFirst(needs, free);
  assert.equal(only.hoursAvailable, 2);
  assert.equal(only.status, "impossible"); // 2/5 = 0.4
});

test("zero free hours anywhere => everything impossible", () => {
  const out = allocateEarliestDueFirst(
    [
      { dueDayIndex: 1, hoursNeeded: 2 },
      { dueDayIndex: 2, hoursNeeded: 2 },
    ],
    [0, 0, 0],
  );
  assert.deepEqual(
    out.map((o) => o.status),
    ["impossible", "impossible"],
  );
});

test("no deadlines => empty result", () => {
  assert.deepEqual(allocateEarliestDueFirst([], [3, 3]), []);
});
