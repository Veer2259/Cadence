/**
 * lib/day-profile.ts — read/seed the singleton day_profile row (id = 1).
 *
 * SPEC section 3: one row, enforced by CHECK (id = 1). Everything that plans a
 * day reads from here at runtime.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dayProfile, type DayProfile } from "@/db/schema";
import type { WeeklyWindows } from "@/lib/time";

export type ProtectedBlock = { label: string; start: string; end: string };

/** Sensible starting point, mirrored by the seed script. Weekdays match the
 *  example payload in SPEC section 6.1; weekends are lighter. */
export const DEFAULT_WORK_WINDOWS: WeeklyWindows = {
  mon: [["09:00", "13:00"], ["14:00", "20:00"]],
  tue: [["09:00", "13:00"], ["14:00", "20:00"]],
  wed: [["09:00", "13:00"], ["14:00", "20:00"]],
  thu: [["09:00", "13:00"], ["14:00", "20:00"]],
  fri: [["09:00", "13:00"], ["14:00", "20:00"]],
  sat: [["10:00", "14:00"]],
  sun: [],
};

export const DEFAULT_SHARP_HOURS: WeeklyWindows = {
  mon: [["09:00", "12:30"]],
  tue: [["09:00", "12:30"]],
  wed: [["09:00", "12:30"]],
  thu: [["09:00", "12:30"]],
  fri: [["09:00", "12:30"]],
  sat: [["10:00", "12:00"]],
  sun: [],
};

export const DEFAULT_PROTECTED_BLOCKS: ProtectedBlock[] = [
  { label: "lunch", start: "13:00", end: "14:00" },
  { label: "family / dinner", start: "20:00", end: "21:30" },
  { label: "sleep", start: "23:30", end: "06:30" },
];

export const DEFAULT_DAY_PROFILE = {
  id: 1 as const,
  workWindows: DEFAULT_WORK_WINDOWS,
  sharpHours: DEFAULT_SHARP_HOURS,
  dailyCapMin: 600,
  protectedBlocks: DEFAULT_PROTECTED_BLOCKS,
  minBlockMin: 30,
  maxBlockMin: 150,
  breakMin: 15,
  timezone: "Asia/Kolkata",
};

/** Shape used across the app once the jsonb columns are narrowed. */
export type DayProfileView = Omit<
  DayProfile,
  "workWindows" | "sharpHours" | "protectedBlocks"
> & {
  workWindows: WeeklyWindows;
  sharpHours: WeeklyWindows;
  protectedBlocks: ProtectedBlock[];
};

function narrow(row: DayProfile): DayProfileView {
  return {
    ...row,
    workWindows: (row.workWindows ?? {}) as WeeklyWindows,
    sharpHours: (row.sharpHours ?? {}) as WeeklyWindows,
    protectedBlocks: (row.protectedBlocks ?? []) as ProtectedBlock[],
  };
}

/** Return the profile, creating the default row the first time it is asked for. */
export async function getOrCreateDayProfile(): Promise<DayProfileView> {
  const existing = await db.query.dayProfile.findFirst({
    where: eq(dayProfile.id, 1),
  });
  if (existing) return narrow(existing);

  const [created] = await db
    .insert(dayProfile)
    .values(DEFAULT_DAY_PROFILE)
    .onConflictDoNothing()
    .returning();

  if (created) return narrow(created);

  // Lost a race — read it back.
  const row = await db.query.dayProfile.findFirst({ where: eq(dayProfile.id, 1) });
  return narrow(row!);
}
