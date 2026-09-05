/**
 * lib/emphasis-honesty.ts — PART 4. Emphasis that is not turning into work.
 *
 * If a bucket has been emphasised on 3 or more of the last 7 days and its tasks
 * have been deferred more over that period, say so. The count and the fact,
 * nothing more: no advice, no encouragement, no "try focusing on…". SPEC §4b's
 * rule for the weekly review applies here — report the gap, never prescribe.
 *
 * ON MEASURING "DEFERRED MORE". `tasks.defer_count` is a running counter with
 * no history, so "has it risen in the last 7 days" cannot be answered from it —
 * there is no earlier value to compare against. Instead this counts the actual
 * deferral EVENTS in the window: overflow rows written against plans in those
 * days. Those are real evidence, already recorded, and they are what increments
 * the counter in the first place.
 */

export const EMPHASIS_DAYS_THRESHOLD = 3;
export const WINDOW_DAYS = 7;

export type BucketDeferral = {
  bucketId: string;
  bucketName: string;
  /** distinct days in the window on which this bucket was emphasised */
  emphasisedDays: number;
  /** deferral events (overflow rows) for this bucket's tasks, in the window */
  deferralsInWindow: number;
  /** the same count for the 7 days BEFORE the window, for the comparison */
  deferralsBefore: number;
};

/**
 * The line to show, or null when there is nothing honest to say.
 *
 * Requires BOTH conditions: emphasised often enough, and deferrals actually up.
 * Emphasis alone says nothing, and deferrals alone are the defer leaderboard's
 * job on the Review screen.
 */
export function emphasisHonestyLine(row: BucketDeferral): string | null {
  if (row.emphasisedDays < EMPHASIS_DAYS_THRESHOLD) return null;
  if (row.deferralsInWindow <= row.deferralsBefore) return null;

  const d = row.emphasisedDays;
  return (
    `${row.bucketName} was emphasised on ${d} of the last ${WINDOW_DAYS} days. ` +
    `Its tasks were deferred ${row.deferralsInWindow} time${row.deferralsInWindow === 1 ? "" : "s"} ` +
    `in that period, against ${row.deferralsBefore} in the ${WINDOW_DAYS} days before.`
  );
}

/** Every line worth showing, most-emphasised first. Empty is the common case. */
export function emphasisHonestyLines(rows: BucketDeferral[]): string[] {
  return rows
    .slice()
    .sort((a, b) => b.emphasisedDays - a.emphasisedDays)
    .map(emphasisHonestyLine)
    .filter((l): l is string => l !== null);
}
