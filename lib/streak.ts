/**
 * lib/streak.ts — consecutive closed days.
 *
 * The one new derived value the Daylight redesign introduces. A day counts as
 * closed when its plan has `debriefedAt` set; the streak is the run of such
 * days ending YESTERDAY, not today.
 *
 * Ending yesterday is deliberate. Today is still in progress, so counting it
 * would make the number fall back to zero every midnight and climb again each
 * evening — a figure that swings for a reason unrelated to whether the person
 * kept the habit. Yesterday's run is a fact; today's is a forecast.
 *
 * The maths is pure and lives here; `loadStreak` is the only part that reads
 * the database.
 */

import { addIstDays } from "@/lib/time";

/**
 * Length of the run of closed days ending the day before `today`.
 *
 * `closedDates` is any collection of IST date strings; order and duplicates do
 * not matter. Walks backwards from yesterday and stops at the first gap.
 */
export function streakEndingYesterday(
  closedDates: Iterable<string>,
  today: string,
): number {
  const closed = new Set(closedDates);
  let run = 0;
  let cursor = addIstDays(today, -1);
  while (closed.has(cursor)) {
    run += 1;
    cursor = addIstDays(cursor, -1);
  }
  return run;
}

/**
 * The longest run of closed days anywhere in `closedDates` — "best run so far".
 *
 * Counts a run from its first day only (a day whose predecessor is absent), so
 * each run is measured exactly once.
 */
export function longestStreak(closedDates: Iterable<string>): number {
  const closed = new Set(closedDates);
  let best = 0;
  for (const day of closed) {
    if (closed.has(addIstDays(day, -1))) continue; // not the start of a run
    let run = 0;
    let cursor = day;
    while (closed.has(cursor)) {
      run += 1;
      cursor = addIstDays(cursor, 1);
    }
    if (run > best) best = run;
  }
  return best;
}

/**
 * The last `days` IST dates ending yesterday, oldest first — the seven dots on
 * the streak card. Each carries whether that day was closed.
 */
export function recentDays(
  closedDates: Iterable<string>,
  today: string,
  days = 7,
): { date: string; closed: boolean }[] {
  const closed = new Set(closedDates);
  const out: { date: string; closed: boolean }[] = [];
  for (let i = days; i >= 1; i--) {
    const date = addIstDays(today, -i);
    out.push({ date, closed: closed.has(date) });
  }
  return out;
}
