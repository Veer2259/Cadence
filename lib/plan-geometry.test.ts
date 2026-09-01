import { test } from "node:test";
import assert from "node:assert/strict";

import { checkDayGeometry, type GeoBlock, type GeometryContext } from "./plan-geometry";

const CTX: GeometryContext = {
  workWindows: [
    ["09:00", "13:00"],
    ["14:00", "20:00"],
  ],
  commitments: [{ start: "11:00", end: "12:00" }],
  protectedBlocks: [{ label: "lunch", start: "13:00", end: "14:00" }],
  dailyCapMin: 600,
};

const b = (title: string, startMin: number, endMin: number, kind = "task"): GeoBlock => ({
  title,
  startMin,
  endMin,
  kind,
});

test("a clean day produces no violations", () => {
  const v = checkDayGeometry(
    [b("deep work", 9 * 60, 10 * 60 + 30), b("email", 14 * 60, 14 * 60 + 30)],
    CTX,
  );
  assert.deepEqual(v, []);
});

test("overlapping blocks are flagged", () => {
  const v = checkDayGeometry(
    [b("A", 9 * 60, 10 * 60), b("B", 9 * 60 + 30, 10 * 60 + 30)],
    CTX,
  );
  assert.ok(v.some((m) => /"A" and "B" overlap/.test(m)), v.join("; "));
});

test("a block outside every working window is flagged", () => {
  const v = checkDayGeometry([b("early bird", 7 * 60, 8 * 60)], CTX);
  assert.ok(v.some((m) => /outside the working windows/.test(m)), v.join("; "));
});

test("a habit is allowed outside the working windows, but not over a commitment", () => {
  // 06:30 gym against a 09:00 work window — the SPEC's own example shape.
  assert.deepEqual(
    checkDayGeometry([b("gym", 6 * 60 + 30, 7 * 60 + 30, "habit")], CTX),
    [],
  );
  const overCommit = checkDayGeometry(
    [b("gym", 11 * 60, 11 * 60 + 30, "habit")],
    CTX,
  );
  assert.ok(
    overCommit.some((m) => /scheduled over a fixed commitment/.test(m)),
    overCommit.join("; "),
  );
});

test("a block spanning the 13:00-14:00 gap is outside the windows", () => {
  const v = checkDayGeometry([b("through lunch", 12 * 60 + 30, 14 * 60 + 30)], CTX);
  assert.ok(v.some((m) => /outside the working windows/.test(m)), v.join("; "));
});

test("a task block over a commitment is flagged; a fixed block over it is not", () => {
  const overCommit = checkDayGeometry([b("call", 11 * 60, 11 * 60 + 30)], CTX);
  assert.ok(
    overCommit.some((m) => /scheduled over a fixed commitment/.test(m)),
    overCommit.join("; "),
  );

  const fixedOverCommit = checkDayGeometry(
    [b("the meeting", 11 * 60, 12 * 60, "fixed")],
    CTX,
  );
  assert.deepEqual(fixedOverCommit, []);
});

test("a block over a protected block is flagged", () => {
  const v = checkDayGeometry([b("squeeze in lunch work", 13 * 60, 13 * 60 + 30)], CTX);
  assert.ok(
    v.some((m) => /scheduled over a protected block/.test(m)),
    v.join("; "),
  );
});

test("exceeding the daily cap is flagged", () => {
  const v = checkDayGeometry(
    [b("marathon", 9 * 60, 13 * 60), b("more", 14 * 60, 21 * 60)],
    { ...CTX, dailyCapMin: 300 },
  );
  assert.ok(v.some((m) => /exceeds the daily cap/.test(m)), v.join("; "));
});

test("a block that ends before it starts is flagged and does not crash the other checks", () => {
  const v = checkDayGeometry(
    [b("inverted", 10 * 60, 9 * 60), b("fine", 15 * 60, 16 * 60)],
    CTX,
  );
  assert.ok(v.some((m) => /ends at or before it starts/.test(m)), v.join("; "));
});
