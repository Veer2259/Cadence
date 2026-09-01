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

import { minutesToHm, type Window } from "@/lib/time";

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

/** An hour needs at least this many samples before it can shape a suggestion. */
export const MIN_SAMPLES_PER_HOUR = 3;
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

export type SharpSuggestion = {
  /** The windows the log supports, as HH:mm pairs. Empty if it supports none. */
  windows: Window[];
  /** Total samples considered. */
  sampleN: number;
  /** Distinct days covered. */
  dayN: number;
  /**
   * True when there is enough history to act on. When false the windows are
   * still returned (so the UI can show what it is leaning towards) but must
   * not be offered as a change.
   */
  confident: boolean;
};

/**
 * The hours the log says you are actually sharp, merged into windows.
 *
 * Deliberately does NOT mutate anything: SPEC's whole posture is that the app
 * shows its reasoning and the person decides. The caller offers this as a
 * suggestion with an Apply button; nothing here writes to day_profile.
 */
export function suggestSharpWindows(samples: EnergySample[]): SharpSuggestion {
  const buckets = bucketByHour(samples);
  const dayN = distinctDays(samples);

  const sharpHours = buckets
    .filter((b) => b.n >= MIN_SAMPLES_PER_HOUR && b.mean >= SHARP_THRESHOLD)
    .map((b) => b.hour)
    .sort((a, b) => a - b);

  // merge contiguous hours into [start, end) windows
  const windows: Window[] = [];
  let runStart: number | null = null;
  let prev: number | null = null;
  for (const h of sharpHours) {
    if (runStart === null) {
      runStart = h;
    } else if (prev !== null && h !== prev + 1) {
      windows.push([minutesToHm(runStart * 60), minutesToHm((prev + 1) * 60)]);
      runStart = h;
    }
    prev = h;
  }
  if (runStart !== null && prev !== null) {
    windows.push([minutesToHm(runStart * 60), minutesToHm((prev + 1) * 60)]);
  }

  const longEnough = windows.filter(([a, b]) => {
    const start = Number(a.slice(0, 2)) * 60 + Number(a.slice(3));
    const end = Number(b.slice(0, 2)) * 60 + Number(b.slice(3));
    return end - start >= MIN_WINDOW_MIN;
  });

  return {
    windows: longEnough,
    sampleN: samples.length,
    dayN,
    confident: dayN >= MIN_DAYS && longEnough.length > 0,
  };
}

/** True when two window lists describe the same hours. */
export function sameWindows(a: Window[], b: Window[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((w, i) => w[0] === b[i][0] && w[1] === b[i][1]);
}
