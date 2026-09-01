/**
 * lib/energy-db.ts — reads and writes for the energy log.
 * The maths lives in lib/energy.ts, which stays pure and testable.
 */

import "server-only";
import { gte, desc } from "drizzle-orm";
import { db } from "@/db";
import { energyLog } from "@/db/schema";
import { istToday, istMinutesOfDay, istDateString } from "@/lib/time";
import type { EnergyLevel, EnergySample } from "@/lib/energy";

/** Record one sample, stamped with the current IST date + minute of day. */
export async function recordEnergy(
  level: EnergyLevel,
  source: "checkin" | "rebalance" = "checkin",
  now: Date = new Date(),
): Promise<void> {
  await db.insert(energyLog).values({
    date: istToday(now),
    at: now,
    minuteOfDay: istMinutesOfDay(now),
    level,
    source,
  });
}

/** Samples from the last `days` IST days, oldest first. */
export async function loadEnergySamples(
  days = 30,
  now: Date = new Date(),
): Promise<EnergySample[]> {
  const cutoff = istDateString(new Date(now.getTime() - days * 86_400_000));
  const rows = await db
    .select({
      date: energyLog.date,
      minuteOfDay: energyLog.minuteOfDay,
      level: energyLog.level,
    })
    .from(energyLog)
    .where(gte(energyLog.date, cutoff));
  return rows.map((r) => ({
    date: r.date,
    minuteOfDay: r.minuteOfDay,
    level: r.level as EnergyLevel,
  }));
}

/** The most recent sample today, if any — so the check-in can show its state. */
export async function latestEnergyToday(
  now: Date = new Date(),
): Promise<{ level: EnergyLevel; minuteOfDay: number } | null> {
  const today = istToday(now);
  const [row] = await db
    .select({ level: energyLog.level, minuteOfDay: energyLog.minuteOfDay })
    .from(energyLog)
    .where(gte(energyLog.date, today))
    .orderBy(desc(energyLog.at))
    .limit(1);
  return row ? { level: row.level as EnergyLevel, minuteOfDay: row.minuteOfDay } : null;
}
