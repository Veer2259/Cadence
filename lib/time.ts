/**
 * lib/time.ts — the single place timezone logic lives.
 *
 * SPEC section 2 + note 618: one timezone (Asia/Kolkata), store UTC everywhere,
 * convert once at the render boundary. IST has no DST, so all the work-window
 * math below is plain arithmetic on "minutes since local midnight".
 *
 * There is a unit-test suite for this file at lib/time.test.ts — run it before
 * building scheduling logic on top.
 */

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const IST = "Asia/Kolkata";

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAY_KEYS: WeekdayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/** A half-open clock interval within one day, e.g. ["09:00","13:00"]. */
export type Window = [string, string];

/** Per-weekday windows, the shape stored in day_profile.work_windows / sharp_hours. */
export type WeeklyWindows = Partial<Record<WeekdayKey, Window[]>>;

/* ------------------------------------------------------------------ */
/*  UTC <-> IST rendering                                             */
/* ------------------------------------------------------------------ */

/** "YYYY-MM-DD" for the IST calendar day that `utc` falls on. */
export function istDateString(utc: Date): string {
  return formatInTimeZone(utc, IST, "yyyy-MM-dd");
}

/** "HH:mm" wall-clock time in IST. */
export function istTimeString(utc: Date): string {
  return formatInTimeZone(utc, IST, "HH:mm");
}

/** Free-form IST formatting (date-fns tokens). */
export function formatIst(utc: Date, fmt: string): string {
  return formatInTimeZone(utc, IST, fmt);
}

/** A Date whose fields, read in local server time, equal the IST wall clock. */
export function istZoned(utc: Date): Date {
  return toZonedTime(utc, IST);
}

/** Turn an IST wall-clock date ("YYYY-MM-DD") + time ("HH:mm") into a UTC instant. */
export function istWallToUtc(dateStr: string, hm = "00:00"): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Not a YYYY-MM-DD date: "${dateStr}"`);
  }
  hmToMinutes(hm); // validate
  return fromZonedTime(`${dateStr}T${hm}:00`, IST);
}

/** A due date entered as a plain day means "by the end of that day" in IST. */
export function istEndOfDayToUtc(dateStr: string): Date {
  return istWallToUtc(dateStr, "23:59");
}

/** Weekday key of the IST calendar day `utc` falls on. */
export function istWeekdayKey(utc: Date): WeekdayKey {
  // date-fns "i" => 1 (Mon) .. 7 (Sun)
  const iso = Number(formatInTimeZone(utc, IST, "i"));
  return WEEKDAY_KEYS[iso - 1];
}

/* ------------------------------------------------------------------ */
/*  Minutes-of-day helpers                                           */
/* ------------------------------------------------------------------ */

/** "09:30" -> 570. Throws on anything that is not a real HH:mm in 00:00..24:00. */
export function hmToMinutes(hm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) throw new Error(`Not a HH:mm time: "${hm}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) {
    throw new Error(`Time out of range: "${hm}"`);
  }
  return h * 60 + min;
}

/** 570 -> "09:30". */
export function minutesToHm(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Interval math (all inputs are minutes since local midnight)      */
/* ------------------------------------------------------------------ */

export type Interval = { start: number; end: number };

export function toIntervals(windows: Window[]): Interval[] {
  return windows.map(([a, b]) => {
    const start = hmToMinutes(a);
    const end = hmToMinutes(b);
    if (end <= start) {
      throw new Error(`Window end must be after start: ${a}-${b}`);
    }
    return { start, end };
  });
}

/** True when [aStart,aEnd) and [bStart,bEnd) share any time. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Merge overlapping/adjacent intervals; result is sorted and disjoint. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((x, y) => x.start - y.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** Total covered minutes, counting overlaps only once. */
export function sumIntervals(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((n, iv) => n + (iv.end - iv.start), 0);
}

/** `base` minus every interval in `cut`. Returns sorted, disjoint free intervals. */
export function subtractIntervals(base: Interval[], cut: Interval[]): Interval[] {
  const cuts = mergeIntervals(cut);
  let pieces = mergeIntervals(base);
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (!overlaps(p, c)) {
        next.push(p);
        continue;
      }
      if (p.start < c.start) next.push({ start: p.start, end: c.start });
      if (c.end < p.end) next.push({ start: c.end, end: p.end });
    }
    pieces = next;
  }
  return pieces;
}

/* ------------------------------------------------------------------ */
/*  Day-profile convenience                                          */
/* ------------------------------------------------------------------ */

/** Windows configured for a given weekday (empty array if none). */
export function windowsForWeekday(weekly: WeeklyWindows, day: WeekdayKey): Window[] {
  return weekly[day] ?? [];
}

/** Total configured minutes for a weekday's windows. */
export function windowMinutesForWeekday(weekly: WeeklyWindows, day: WeekdayKey): number {
  return sumIntervals(toIntervals(windowsForWeekday(weekly, day)));
}

/**
 * Validate a WeeklyWindows object: every entry a real HH:mm, end after start,
 * and no two windows on the same day overlapping. Returns a list of problems
 * (empty = valid) so a settings form can show them inline.
 */
export function validateWeeklyWindows(weekly: WeeklyWindows): string[] {
  const problems: string[] = [];
  for (const day of WEEKDAY_KEYS) {
    const windows = weekly[day];
    if (!windows) continue;
    let intervals: Interval[];
    try {
      intervals = toIntervals(windows);
    } catch (e) {
      problems.push(`${day}: ${(e as Error).message}`);
      continue;
    }
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (overlaps(sorted[i - 1], sorted[i])) {
        problems.push(`${day}: windows overlap`);
        break;
      }
    }
  }
  return problems;
}
