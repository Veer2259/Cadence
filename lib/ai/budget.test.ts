/**
 * lib/ai/budget.test.ts — the outbound-call ceiling and the RPD/RPM split.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CallBudget,
  ModelBudgetError,
  classifyRateError,
} from "./budget";

test("CallBudget hands out exactly `max` claims, then throws", () => {
  const b = new CallBudget(3, "compose");
  assert.equal(b.claim(), 1);
  assert.equal(b.claim(), 2);
  assert.equal(b.claim(), 3);
  assert.equal(b.remaining, 0);
  assert.throws(() => b.claim(), ModelBudgetError);
  assert.throws(() => b.claim(), ModelBudgetError); // still throws, still 3 spent
  assert.equal(b.spent, 3);
});

test("a shared budget across retry layers cannot exceed the cap", () => {
  // simulate: initial call + 2 backoff retries would be 3, a Zod retry would be
  // a 4th — but the budget only allows 3.
  const b = new CallBudget(3, "compose");
  let calls = 0;
  const doCall = () => {
    b.claim();
    calls += 1;
  };
  doCall();
  doCall();
  doCall();
  assert.throws(doCall, ModelBudgetError);
  assert.equal(calls, 3);
});

test("classifyRateError distinguishes per-day from per-minute 429s", () => {
  const rpd = {
    status: 429,
    message:
      '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for quota metric \'GenerateRequestsPerDayPerProjectPerModel-FreeTier\'","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}',
  };
  const rpm = {
    status: 429,
    message:
      '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for quota metric \'GenerateRequestsPerMinutePerProjectPerModel-FreeTier\'"}}',
  };
  assert.equal(classifyRateError(rpd), "rpd");
  assert.equal(classifyRateError(rpm), "rpm");
});

test("classifyRateError: bare 429 with no detail is treated as per-minute", () => {
  assert.equal(classifyRateError({ status: 429, message: "Too Many Requests" }), "rpm");
});

test("classifyRateError flags transient 5xx and ignores the rest", () => {
  assert.equal(classifyRateError({ status: 503, message: "UNAVAILABLE" }), "5xx");
  assert.equal(classifyRateError({ status: 500, message: "internal" }), "5xx");
  assert.equal(classifyRateError({ status: 400, message: "bad request" }), null);
  assert.equal(classifyRateError(new Error("network")), null);
  assert.equal(classifyRateError(new ModelBudgetError(3, 3, "x")), null);
});
