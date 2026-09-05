import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionProblems,
  canConfirm,
  includedSessions,
  excludedSessions,
  groupByDay,
  importRange,
  commitmentsToReplace,
  toCommitments,
} from "./timetable";
import { istDateString, istTimeString } from "./time";
import type { TimetableSession } from "./schemas";

/**
 * Fixture from the real sheet: BITS School of Management, Term 4 (Block 20),
 * 31 Aug - 13 Sept 2026. Section B, so PWMC_B 09:00-10:30 and ABMA_B
 * 13:30-16:30; the _A sections are excluded.
 */
const s = (o: Partial<TimetableSession> = {}): TimetableSession => ({
  date: "2026-09-07",
  start: "09:00",
  end: "10:30",
  title: "PWMC_B",
  subjectCode: "PWMC",
  location: "S03, Second Floor Academic Block 1",
  excluded: false,
  reason: null,
  uncertain: false,
  ...o,
});

const REAL_DAY: TimetableSession[] = [
  s({ title: "PWMC_B", start: "09:00", end: "10:30", subjectCode: "PWMC" }),
  s({
    title: "ABMA_B",
    start: "13:30",
    end: "16:30",
    subjectCode: "ABMA",
    location: "S02, Second Floor Academic Block 1",
  }),
  s({
    title: "ABMA_A",
    start: "09:00",
    end: "12:00",
    subjectCode: "ABMA",
    excluded: true,
    reason: "Section A — not taken",
  }),
  s({
    title: "PWMC_A",
    start: "13:30",
    end: "15:00",
    subjectCode: "PWMC",
    excluded: true,
    reason: "Section A — not taken",
  }),
];

/* ------------------------------------------------------------------ */
/*  Date / time mapping                                               */
/* ------------------------------------------------------------------ */

test("IST times map to the right UTC instants", () => {
  const [pwmc, abma] = toCommitments(REAL_DAY);
  // 09:00 IST = 03:30 UTC; IST is UTC+5:30 and has no DST.
  assert.equal(pwmc.startAt.toISOString(), "2026-09-07T03:30:00.000Z");
  assert.equal(pwmc.endAt.toISOString(), "2026-09-07T05:00:00.000Z");
  assert.equal(abma.startAt.toISOString(), "2026-09-07T08:00:00.000Z");
  assert.equal(abma.endAt.toISOString(), "2026-09-07T11:00:00.000Z");
});

test("a stored instant renders back to the IST clock time on the sheet", () => {
  const [pwmc] = toCommitments(REAL_DAY);
  assert.equal(istDateString(pwmc.startAt), "2026-09-07");
  assert.equal(istTimeString(pwmc.startAt), "09:00");
  assert.equal(istTimeString(pwmc.endAt), "10:30");
});

test("an evening class does not roll into the next IST day", () => {
  const [c] = toCommitments([s({ start: "18:00", end: "21:00", excluded: false })]);
  assert.equal(istDateString(c.startAt), "2026-09-07");
  assert.equal(istDateString(c.endAt), "2026-09-07");
});

test("the location is carried onto the commitment title", () => {
  const [pwmc] = toCommitments(REAL_DAY);
  assert.match(pwmc.title, /^PWMC_B · S03/);
});

/* ------------------------------------------------------------------ */
/*  Exclusion filter                                                  */
/* ------------------------------------------------------------------ */

test("only the section actually taken becomes a commitment", () => {
  const kept = includedSessions(REAL_DAY).map((x) => x.title);
  assert.deepEqual(kept, ["PWMC_B", "ABMA_B"]);
  assert.equal(toCommitments(REAL_DAY).length, 2);
});

test("excluded sessions are RETAINED for display, with their reason", () => {
  const dropped = excludedSessions(REAL_DAY);
  assert.equal(dropped.length, 2);
  assert.deepEqual(dropped.map((x) => x.title), ["ABMA_A", "PWMC_A"]);
  // a wrongly dropped class is invisible unless the reason travels with it
  assert.ok(dropped.every((x) => x.reason && x.reason.length > 0));
});

test("an excluded session is never a blocking problem", () => {
  // no date AND excluded: it is a decision, not a failure
  const rows = [s({ excluded: true, date: null, reason: "Section A" })];
  assert.deepEqual(sessionProblems(rows), []);
  assert.equal(canConfirm(rows), true);
});

/* ------------------------------------------------------------------ */
/*  Missing-date failure path                                         */
/* ------------------------------------------------------------------ */

test("a session with no date BLOCKS confirmation — never guessed", () => {
  const rows = [...REAL_DAY, s({ title: "ABMA_B", date: null })];
  const problems = sessionProblems(rows);
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /no date/);
  assert.equal(canConfirm(rows), false);
});

test("no date is not filled in from the current week or a weekday", () => {
  const rows = [s({ date: null })];
  // The only correct behaviour is to refuse, not to produce a commitment.
  assert.equal(canConfirm(rows), false);
  assert.throws(() => toCommitments(rows), /has no date or time/);
});

test("a session with a date but no times also blocks", () => {
  const rows = [s({ start: null, end: null })];
  assert.match(sessionProblems(rows)[0].problem, /no start\/end/);
  assert.equal(canConfirm(rows), false);
});

test("an end at or before its start blocks", () => {
  assert.match(
    sessionProblems([s({ start: "13:30", end: "13:30" })])[0].problem,
    /at or before/,
  );
  assert.match(
    sessionProblems([s({ start: "16:30", end: "13:30" })])[0].problem,
    /at or before/,
  );
});

test("undated rows are still shown, grouped apart", () => {
  const { days, undated } = groupByDay([...REAL_DAY, s({ title: "???", date: null })]);
  assert.equal(undated.length, 1);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-09-07");
});

test("days come back in date order with times ascending", () => {
  const { days } = groupByDay([
    s({ date: "2026-09-08", start: "13:30", end: "16:30", title: "ABMA_B" }),
    s({ date: "2026-09-07", start: "13:30", end: "16:30", title: "ABMA_B" }),
    s({ date: "2026-09-08", start: "09:00", end: "10:30", title: "PWMC_B" }),
  ]);
  assert.deepEqual(days.map((d) => d.date), ["2026-09-07", "2026-09-08"]);
  assert.deepEqual(days[1].sessions.map((x) => x.title), ["PWMC_B", "ABMA_B"]);
});

/* ------------------------------------------------------------------ */
/*  Overlap replacement                                               */
/* ------------------------------------------------------------------ */

const existing = [
  { id: "t1", title: "PWMC_B", date: "2026-09-07", source: "timetable" as const },
  { id: "t2", title: "ABMA_B", date: "2026-09-11", source: "timetable" as const },
  { id: "t3", title: "PWMC_B", date: "2026-08-31", source: "timetable" as const },
  { id: "m1", title: "Dentist", date: "2026-09-08", source: "manual" as const },
];

test("a re-import replaces only imported rows inside the new range", () => {
  const doomed = commitmentsToReplace(existing, { start: "2026-09-07", end: "2026-09-11" });
  assert.deepEqual(doomed.map((c) => c.id), ["t1", "t2"]);
});

test("a MANUAL commitment inside the range is never touched", () => {
  const doomed = commitmentsToReplace(existing, { start: "2026-09-01", end: "2026-09-30" });
  assert.ok(!doomed.some((c) => c.source === "manual"), "manual rows must survive");
  assert.ok(!doomed.some((c) => c.id === "m1"));
});

test("imported rows OUTSIDE the new range survive", () => {
  const doomed = commitmentsToReplace(existing, { start: "2026-09-07", end: "2026-09-11" });
  assert.ok(!doomed.some((c) => c.id === "t3"), "31 Aug is outside 7-11 Sep");
});

test("the range is inclusive at both ends", () => {
  const doomed = commitmentsToReplace(existing, { start: "2026-09-07", end: "2026-09-07" });
  assert.deepEqual(doomed.map((c) => c.id), ["t1"]);
});

test("importRange spans the rows that will be written", () => {
  const range = importRange([
    s({ date: "2026-09-07" }),
    s({ date: "2026-09-11" }),
    s({ date: "2026-09-08" }),
  ]);
  assert.deepEqual(range, { start: "2026-09-07", end: "2026-09-11" });
});

test("an EXCLUDED row does not stretch the range", () => {
  // Otherwise a class the person does not attend would widen the blast radius
  // of the replacement into days the new sheet says nothing about.
  const range = importRange([
    s({ date: "2026-09-07" }),
    s({ date: "2026-12-25", excluded: true, reason: "not taken" }),
  ]);
  assert.deepEqual(range, { start: "2026-09-07", end: "2026-09-07" });
});

test("exam dates count towards the range", () => {
  const range = importRange(
    [s({ date: "2026-09-07" })],
    [
      {
        date: "2026-09-12",
        start: null,
        end: null,
        subjectCode: "PWMC",
        subjectName: null,
        kind: "end_block",
        location: null,
        title: "EB Exam",
        uncertain: false,
      },
    ],
  );
  assert.deepEqual(range, { start: "2026-09-07", end: "2026-09-12" });
});

test("nothing to write means no range, so nothing is replaced", () => {
  assert.equal(importRange([s({ excluded: true, reason: "not taken" })]), null);
});
