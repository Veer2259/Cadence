/**
 * lib/timetable.ts — turning a parsed timetable into commitments, safely.
 *
 * Everything here is pure. The model's job is to read the PDF; this decides
 * what may be written, and it refuses to invent anything the sheet did not say.
 *
 * Three rules it exists to enforce:
 *
 *  1. A session with no date is a PARSE FAILURE. Never fall back to the current
 *     week, a day-of-week assumption, or today. A class on the wrong date
 *     corrupts every plan built on top of it, and unlike a missing class it
 *     looks correct.
 *  2. An excluded session is SHOWN, struck through, with its reason. A silently
 *     dropped class is invisible, and invisible is how a wrong exclusion
 *     survives to ruin a fortnight.
 *  3. A re-import replaces only what a previous import created, and only inside
 *     the range the new import covers. A manually created commitment is never
 *     touched.
 */

import type { TimetableSession, TimetableExam } from "@/lib/schemas";
import { istDayInstant } from "@/lib/time";

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

export type SessionProblem = {
  index: number;
  title: string;
  /** why this row cannot be written */
  problem: string;
};

/**
 * Rows that cannot be confirmed, with the reason.
 *
 * An EXCLUDED row is not a problem — it is a decision, and it is shown as one.
 * Only a row we would otherwise write, and cannot, counts here.
 */
export function sessionProblems(sessions: TimetableSession[]): SessionProblem[] {
  const out: SessionProblem[] = [];
  sessions.forEach((s, index) => {
    if (s.excluded) return;
    if (!s.date) {
      out.push({
        index,
        title: s.title,
        problem: "no date could be read from the timetable",
      });
      return;
    }
    if (!s.start || !s.end) {
      out.push({ index, title: s.title, problem: "no start/end time could be read" });
      return;
    }
    if (s.end <= s.start) {
      out.push({
        index,
        title: s.title,
        problem: `ends (${s.end}) at or before it starts (${s.start})`,
      });
    }
  });
  return out;
}

/** True when every row the import would write is complete enough to write. */
export function canConfirm(sessions: TimetableSession[]): boolean {
  return sessionProblems(sessions).length === 0;
}

/** The sessions that would actually become commitments. */
export function includedSessions(sessions: TimetableSession[]): TimetableSession[] {
  return sessions.filter((s) => !s.excluded);
}

/** The sessions deliberately left out — rendered, never hidden. */
export function excludedSessions(sessions: TimetableSession[]): TimetableSession[] {
  return sessions.filter((s) => s.excluded);
}

/* ------------------------------------------------------------------ */
/*  Grouping and range                                                 */
/* ------------------------------------------------------------------ */

export type DayGroup = { date: string; sessions: TimetableSession[] };

/**
 * Sessions grouped by IST day, in date order, times ascending.
 *
 * Undated rows are grouped under a null date so they are still SHOWN — they are
 * the parse failures, and hiding them would defeat the point.
 */
export function groupByDay(sessions: TimetableSession[]): {
  days: DayGroup[];
  undated: TimetableSession[];
} {
  const byDate = new Map<string, TimetableSession[]>();
  const undated: TimetableSession[] = [];
  for (const s of sessions) {
    if (!s.date) {
      undated.push(s);
      continue;
    }
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      sessions: list.sort((x, y) => (x.start ?? "").localeCompare(y.start ?? "")),
    }));
  return { days, undated };
}

/**
 * The IST date range an import covers — from the rows it will WRITE.
 *
 * Excluded rows are deliberately not counted: a range stretched by a class the
 * person does not attend would replace imported commitments in days the new
 * sheet says nothing about.
 */
export function importRange(
  sessions: TimetableSession[],
  exams: TimetableExam[] = [],
): { start: string; end: string } | null {
  const dates = [
    ...includedSessions(sessions).map((s) => s.date),
    ...exams.map((e) => e.date),
  ].filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  dates.sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

/* ------------------------------------------------------------------ */
/*  Replacement                                                        */
/* ------------------------------------------------------------------ */

export type ExistingCommitment = {
  id: string;
  title: string;
  /** IST date */
  date: string;
  source: "manual" | "timetable";
};

/**
 * Which existing commitments a new import supersedes.
 *
 * ONLY previous timetable imports, and ONLY inside the new range. A manual
 * commitment sitting in the same week is left exactly where it is — the person
 * put it there, and no import gets to decide it was wrong.
 */
export function commitmentsToReplace(
  existing: ExistingCommitment[],
  range: { start: string; end: string },
): ExistingCommitment[] {
  return existing.filter(
    (c) =>
      c.source === "timetable" && c.date >= range.start && c.date <= range.end,
  );
}

/* ------------------------------------------------------------------ */
/*  Conversion                                                         */
/* ------------------------------------------------------------------ */

export type NewCommitment = {
  title: string;
  startAt: Date;
  endAt: Date;
};

/**
 * Parsed sessions → commitment rows.
 *
 * Every IST → UTC conversion goes through lib/time.ts, which is the only place
 * in this codebase that converts. Throws on an incomplete row rather than
 * skipping it, because `sessionProblems` has already been run and a row
 * reaching here without a date is a bug, not a user error to swallow.
 */
export function toCommitments(sessions: TimetableSession[]): NewCommitment[] {
  return includedSessions(sessions).map((s) => {
    if (!s.date || !s.start || !s.end) {
      throw new Error(
        `"${s.title}" has no date or time — it must not reach toCommitments()`,
      );
    }
    return {
      title: s.location ? `${s.title} · ${s.location}` : s.title,
      startAt: istDayInstant(s.date, s.start),
      endAt: istDayInstant(s.date, s.end),
    };
  });
}

/** Exams that can be written — an undated exam is a parse failure like any other. */
export function datedExams(exams: TimetableExam[]): TimetableExam[] {
  return exams.filter((e) => !!e.date);
}
