import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emphasisHonestyLine,
  emphasisHonestyLines,
  EMPHASIS_DAYS_THRESHOLD,
  type BucketDeferral,
} from "./emphasis-honesty";

const row = (o: Partial<BucketDeferral> = {}): BucketDeferral => ({
  bucketId: "b1",
  bucketName: "case_comps",
  emphasisedDays: 4,
  deferralsInWindow: 5,
  deferralsBefore: 2,
  ...o,
});

test("the threshold is 3 days in the last 7", () => {
  assert.equal(EMPHASIS_DAYS_THRESHOLD, 3);
});

test("says nothing below the emphasis threshold", () => {
  assert.equal(emphasisHonestyLine(row({ emphasisedDays: 2 })), null);
});

test("says nothing when deferrals have not risen", () => {
  assert.equal(emphasisHonestyLine(row({ deferralsInWindow: 2, deferralsBefore: 2 })), null);
  assert.equal(emphasisHonestyLine(row({ deferralsInWindow: 1, deferralsBefore: 4 })), null);
});

test("fires exactly at the boundary", () => {
  assert.ok(emphasisHonestyLine(row({ emphasisedDays: 3, deferralsInWindow: 3, deferralsBefore: 2 })));
});

test("the line is the count and the fact — no advice, no encouragement", () => {
  const line = emphasisHonestyLine(row())!;
  assert.match(line, /emphasised on 4 of the last 7 days/);
  assert.match(line, /deferred 5 times/);
  assert.match(line, /against 2 in the 7 days before/);
  // descriptive only, per SPEC 4b
  assert.doesNotMatch(line, /should|try|consider|need to|make sure|why not|focus on|keep going|well done/i);
  assert.doesNotMatch(line, /!/);
});

test("singular deferral reads correctly", () => {
  const line = emphasisHonestyLine(row({ deferralsInWindow: 1, deferralsBefore: 0 }))!;
  assert.match(line, /deferred 1 time\b/);
});

test("lines come back most-emphasised first, and silent rows are dropped", () => {
  const lines = emphasisHonestyLines([
    row({ bucketName: "quiet", emphasisedDays: 1 }),
    row({ bucketName: "cv", emphasisedDays: 3, deferralsInWindow: 4, deferralsBefore: 1 }),
    row({ bucketName: "case_comps", emphasisedDays: 6, deferralsInWindow: 7, deferralsBefore: 3 }),
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^case_comps/);
  assert.match(lines[1], /^cv/);
});

test("no emphasis at all produces no lines", () => {
  assert.deepEqual(emphasisHonestyLines([]), []);
});
