/**
 * lib/energy.ts — turning "how sharp am I right now" samples into something
 * the planner can use.
 *
 * Pure module (no db, no "server-only") so it is unit-testable and can be
 * imported from a client component. The reads/writes live in lib/energy-db.ts.
 *
 * The point of recording energy against a MINUTE OF DAY rather than a day is
 * that sharp_hours is a statement about hours. One value per day cannot tell
 * you that you think clearly from 10:00 to 13:00; a scatter of timestamped
 * samples can.
 */


export type EnergyLevel = "fried" | "ok" | "sharp";

/** Worst -> best. The ordinal is the whole point: it lets us average. */
export const ENERGY_LEVELS: readonly EnergyLevel[] = ["fried", "ok", "sharp"] as const;
export const ENERGY_SCORE: Record<EnergyLevel, number> = { fried: 0, ok: 1, sharp: 2 };

export type EnergySample = {
  /** IST calendar date, YYYY-MM-DD */
  date: string;
  /** minutes since IST midnight */
  minuteOfDay: number;
  level: EnergyLevel;
};

export type HourBucket = {
  /** 0..23 */
  hour: number;
  /** how many samples fell in this hour */
  n: number;
  /** mean score, 0 (fried) .. 2 (sharp) */
  mean: number;
  /** how many distinct days contributed */
  days: number;
};

/* ------------------------------------------------------------------ */
/*  Thresholds — deliberately conservative. A suggestion that fires on */
/*  three data points would be worse than no suggestion at all.        */
/* ------------------------------------------------------------------ */

/** And the log overall needs this many distinct days. */
export const MIN_DAYS = 5;
/** Mean at or above this reads as "sharp" (0 fried, 1 ok, 2 sharp). */
export const SHARP_THRESHOLD = 1.5;
/** Never suggest a sharp window shorter than this. */
export const MIN_WINDOW_MIN = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Group samples into hour-of-day buckets. Only hours with data are returned. */
export function bucketByHour(samples: EnergySample[]): HourBucket[] {
  const byHour = new Map<number, { total: number; n: number; days: Set<string> }>();
  for (const s of samples) {
    if (s.minuteOfDay < 0 || s.minuteOfDay > 1439) continue;
    const hour = Math.floor(s.minuteOfDay / 60);
    const cur = byHour.get(hour) ?? { total: 0, n: 0, days: new Set<string>() };
    cur.total += ENERGY_SCORE[s.level];
    cur.n += 1;
    cur.days.add(s.date);
    byHour.set(hour, cur);
  }
  return [...byHour.entries()]
    .map(([hour, v]) => ({ hour, n: v.n, mean: round2(v.total / v.n), days: v.days.size }))
    .sort((a, b) => a.hour - b.hour);
}

/** How many distinct days the log covers. */
export function distinctDays(samples: EnergySample[]): number {
  return new Set(samples.map((s) => s.date)).size;
}

