import { test } from "node:test";
import assert from "node:assert/strict";
import { goalHorizon, targetWeeksFor, SHORT_HORIZON_WEEKS } from "./goal-horizon";

test("the threshold is one named constant, at four weeks", () => {
  assert.equal(SHORT_HORIZON_WEEKS, 4);
});

test("more than four weeks out slices into weekly targets", () => {
  // 29 days = 4.14 weeks
  const h = goalHorizon("2026-10-04", "2026-09-05");
  assert.equal(h.days, 29);
  assert.equal(h.mode, "targets");
});

test("well inside four weeks goes direct to tasks", () => {
  const h = goalHorizon("2026-09-12", "2026-09-05"); // 7 days
  assert.equal(h.days, 7);
  assert.equal(h.mode, "direct");
});

test("EXACTLY four weeks is direct — the boundary is inclusive of the short side", () => {
  // 28 days is 4.0 weeks. Four weekly targets whose last one ends on the
  // deadline adds a layer without adding information.
  const h = goalHorizon("2026-10-03", "2026-09-05");
  assert.equal(h.days, 28);
  assert.equal(h.weeks, 4);
  assert.equal(h.mode, "direct");
});

test("one day past the boundary flips to targets", () => {
  const h = goalHorizon("2026-10-04", "2026-09-05");
  assert.equal(h.days, 29);
  assert.equal(h.mode, "targets");
});

test("the real failing case — a goal two days out — is direct, not empty", () => {
  // case_comps: outcome_target_date 2026-09-07, set on 2026-09-05. This
  // produced zero weekly targets and therefore zero tasks.
  const h = goalHorizon("2026-09-07", "2026-09-05");
  assert.equal(h.mode, "direct");
});

test("an overdue goal is still direct, not an error", () => {
  const h = goalHorizon("2026-09-01", "2026-09-05");
  assert.equal(h.days, -4);
  assert.equal(h.mode, "direct");
});

test("no target date means no horizon to branch on", () => {
  assert.equal(goalHorizon(null, "2026-09-05").mode, "none");
});

test("targetWeeksFor starts with the week you are IN, not the coming Monday", () => {
  // 2026-09-05 is a Saturday; that week's Monday is 2026-08-31.
  const weeks = targetWeeksFor("2026-08-31", "2026-10-04");
  assert.equal(weeks[0], "2026-08-31");
  assert.ok(weeks.includes("2026-09-07"));
});

test("targetWeeksFor stops at the deadline", () => {
  const weeks = targetWeeksFor("2026-08-31", "2026-09-20");
  assert.deepEqual(weeks, ["2026-08-31", "2026-09-07", "2026-09-14"]);
});

test("targetWeeksFor returns nothing when the deadline is already past", () => {
  assert.deepEqual(targetWeeksFor("2026-08-31", "2026-08-24"), []);
});
