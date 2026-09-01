/**
 * lib/habits.ts — habit cadence: a real structure, and the rule that decides
 * which days a habit lands on.
 *
 * `habits.cadence` is a jsonb value of one of three shapes:
 *   { kind: "daily" }                       every working day
 *   { kind: "days", days: ["mon","wed"] }   those specific weekdays
 *   { kind: "per_week", count: 5 }          N times a week; we distribute them
 *
 * Pure module (no db, no "server-only") so it is unit-tested and shared by
 * compose and the Settings form.
 */

import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/time";

export type HabitCadence =
  | { kind: "daily" }
  | { kind: "days"; days: WeekdayKey[] }
  | { kind: "per_week"; count: number };

const isWeekday = (s: string): s is WeekdayKey =>
  (WEEKDAY_KEYS as string[]).includes(s);

/** Coerce an unknown jsonb value into a valid HabitCadence (defensive read). */
export function narrowCadence(raw: unknown): HabitCadence {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.kind === "daily") return { kind: "daily" };
    if (o.kind === "days" && Array.isArray(o.days)) {
      const days = o.days.filter((d): d is WeekdayKey => typeof d === "string" && isWeekday(d));
      if (days.length) return { kind: "days", days: dedupeDays(days) };
    }
    if (o.kind === "per_week") {
      const n = Math.round(Number(o.count));
      if (Number.isFinite(n) && n >= 1) return { kind: "per_week", count: Math.min(7, n) };
    }
  }
  // Unreadable — a sane, visible default rather than a crash.
  return { kind: "per_week", count: 3 };
}

/** "daily", "5×/week", "3×/week", "mon, wed, fri". */
export function formatCadence(c: HabitCadence): string {
  switch (c.kind) {
    case "daily":
      return "daily";
    case "per_week":
      return `${c.count}×/week`;
    case "days":
      return orderDays(c.days).join(", ");
  }
}

/**
 * Parse the free-text a person might type in Settings. Mirrors the SQL used to
 * migrate the old rows.
 *   "daily" | "every day"                         -> daily
 *   "5x/week" | "5 x week" | "5 times a week"      -> per_week 5
 *   "mon,wed,fri" | "Mon Wed Fri"                  -> days [...]
 * Anything else falls back to per_week 3.
 */
export function parseCadenceText(input: string): HabitCadence {
  const s = input.trim().toLowerCase();
  if (s === "daily" || s === "every day") return { kind: "daily" };

  const perWeek = s.match(/^(\d+)\s*(?:x|times)?\s*(?:\/|per|a| )?\s*week/);
  if (perWeek) {
    const n = Math.min(7, Math.max(1, parseInt(perWeek[1], 10)));
    return { kind: "per_week", count: n };
  }

  const days = s
    .split(/[^a-z]+/)
    .map((t) => t.slice(0, 3))
    .filter(isWeekday);
  if (days.length) return { kind: "days", days: dedupeDays(days) };

  return { kind: "per_week", count: 3 };
}

/**
 * The weekdays this habit should occupy in a week whose *working* days are
 * `availableWeekdays` (weekdays that have at least one work window).
 *
 *   daily     -> every available day
 *   days      -> the listed days that are also available
 *   per_week  -> `count` days spread as evenly as possible across the available
 *               ones (deterministic; no persistence). If count >= available, all.
 */
export function habitDaysForWeek(
  c: HabitCadence,
  availableWeekdays: WeekdayKey[],
): WeekdayKey[] {
  const avail = orderDays(availableWeekdays);
  if (avail.length === 0) return [];

  if (c.kind === "daily") return avail;
  if (c.kind === "days") return avail.filter((d) => c.days.includes(d));

  const n = Math.min(c.count, avail.length);
  if (n <= 0) return [];
  if (n === avail.length) return avail;
  if (n === 1) return [avail[Math.floor((avail.length - 1) / 2)]];

  const picks: WeekdayKey[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (avail.length - 1)) / (n - 1));
    picks.push(avail[idx]);
  }
  return dedupeDays(picks);
}

/** Is this habit due on `weekday`, given the week's working days? */
export function isHabitDueOn(
  c: HabitCadence,
  weekday: WeekdayKey,
  availableWeekdays: WeekdayKey[],
): boolean {
  return habitDaysForWeek(c, availableWeekdays).includes(weekday);
}

/* -------------------------------------------------------------- helpers */

function orderDays(days: WeekdayKey[]): WeekdayKey[] {
  return WEEKDAY_KEYS.filter((k) => days.includes(k));
}

function dedupeDays(days: WeekdayKey[]): WeekdayKey[] {
  return orderDays([...new Set(days)]);
}
