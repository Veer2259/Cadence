/**
 * lib/pressure.ts — deadline pressure (SPEC section 5). Deterministic; the model
 * only comments on the numbers it produces (see lib/ai/modes/week.ts).
 */

import "server-only";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, commitments, plans, blocks } from "@/db/schema";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { applyCalibration, type CategoryRatio } from "@/lib/calibration";
import { calibration as calibrationTable } from "@/db/schema";
import {
  istDateString,
  istWeekdayKeyForDate,
  istMinutesOfDay,
  windowsForWeekday,
  toIntervals,
  subtractIntervals,
  sumIntervals,
  type Interval,
} from "@/lib/time";
import {
  allocateEarliestDueFirst,
  type PressureStatus,
} from "@/lib/pressure-alloc";

const HORIZON_DAYS = 14;
const FRICTION = 0.15;
const FALLBACK_ESTIMATE_MIN = 30;

export type PressureDeadline = {
  taskId: string;
  title: string;
  bucketName: string | null;
  dueAt: string; // ISO
  dueDate: string; // IST YYYY-MM-DD
  hoursNeeded: number;
  hoursAvailable: number;
  ratio: number;
  status: PressureStatus;
};

export type PressureDay = {
  date: string; // IST YYYY-MM-DD
  weekday: string;
  freeHours: number;
};

export type PressureResult = {
  now: string;
  horizonDays: number;
  days: PressureDay[];
  deadlines: PressureDeadline[];
};

/** midnight->minute intervals for a clock-time list, splitting past-midnight wraps */
function clockIntervals(pairs: [string, string][]): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of pairs) {
    let s: number;
    let e: number;
    try {
      const iv = toIntervals([[a, b]])[0];
      s = iv.start;
      e = iv.end;
      out.push({ start: s, end: e });
    } catch {
      // wrap or malformed
      const toMin = (t: string) => {
        const m = /^(\d{2}):(\d{2})$/.exec(t);
        return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
      };
      s = toMin(a);
      e = toMin(b);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
        out.push({ start: s, end: 1440 });
        out.push({ start: 0, end: e });
      }
    }
  }
  return out;
}

export async function computePressure(now = new Date()): Promise<PressureResult> {
  const profile = await getOrCreateDayProfile();
  const today = istDateString(now);
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

  // --- calibration (category) ---
  const calRows = await db
    .select()
    .from(calibrationTable)
  const calByCategory = new Map<string, CategoryRatio>(
    calRows.map((r) => [r.key, { ratio: Number(r.ratio), sampleN: r.sampleN }]),
  );

  // --- deadlines: active tasks due within the horizon (+ their active subtasks) ---
  const dueTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "active"),
        sql`${tasks.dueAt} is not null`,
        lte(tasks.dueAt, horizonEnd),
      ),
    );

  const bucketRows = await db.query.buckets.findMany();
  const bucketName = new Map(bucketRows.map((b) => [b.id, b.name]));

  function hoursNeededFor(t: (typeof dueTasks)[number]): number {
    const own = applyCalibration(
      t.estimateMin ?? FALLBACK_ESTIMATE_MIN,
      calByCategory.get(t.category),
    ).calibratedMin;
    return own / 60;
  }

  // --- free hours per IST day, today .. furthest due date (bounded by horizon) ---
  const furthestDue = dueTasks.reduce(
    (max, t) => (t.dueAt && t.dueAt > max ? t.dueAt : max),
    now,
  );
  const lastDay = furthestDue > horizonEnd ? horizonEnd : furthestDue;

  const dayList: string[] = [];
  for (let d = new Date(now); istDateString(d) <= istDateString(lastDay); d = new Date(d.getTime() + 86_400_000)) {
    dayList.push(istDateString(d));
    if (dayList.length > HORIZON_DAYS + 1) break;
  }

  // commitments + committed-plan blocks in range, grouped by IST day
  const rangeCommitments = await db
    .select()
    .from(commitments)
    .where(and(gte(commitments.endAt, now), lte(commitments.startAt, horizonEnd)));

  const committedPlans = await db
    .select({ id: plans.id, date: plans.date })
    .from(plans)
    .where(and(eq(plans.status, "committed"), inArray(plans.date, dayList)));
  const planIds = committedPlans.map((p) => p.id);
  const planBlocks = planIds.length
    ? await db.select().from(blocks).where(inArray(blocks.planId, planIds))
    : [];
  const planDateById = new Map(committedPlans.map((p) => [p.id, p.date]));

  const days: PressureDay[] = dayList.map((date) => {
    const weekday = istWeekdayKeyForDate(date);
    const windows = clockIntervals(windowsForWeekday(profile.workWindows, weekday));
    let free = windows;

    // subtract protected blocks
    const prot = clockIntervals(
      (profile.protectedBlocks as { start: string; end: string }[]).map((p) => [p.start, p.end]),
    );
    free = subtractIntervals(free, prot);

    // subtract fixed commitments on this day
    const dayCommit: Interval[] = [];
    for (const c of rangeCommitments) {
      if (istDateString(c.startAt) === date || istDateString(c.endAt) === date) {
        dayCommit.push({ start: istMinutesOfDay(c.startAt), end: Math.max(istMinutesOfDay(c.endAt), istMinutesOfDay(c.startAt) + 1) });
      }
    }
    free = subtractIntervals(free, dayCommit);

    // subtract already-committed plan blocks on this day
    const dayPlanBlocks: Interval[] = [];
    for (const b of planBlocks) {
      if (planDateById.get(b.planId) !== date) continue;
      const s = istMinutesOfDay(b.startAt);
      let e = istMinutesOfDay(b.endAt);
      if (e <= s) e = 1440;
      dayPlanBlocks.push({ start: s, end: e });
    }
    free = subtractIntervals(free, dayPlanBlocks);

    // today: only the part of the day still ahead
    if (date === today) {
      const nowMin = istMinutesOfDay(now);
      free = subtractIntervals(free, [{ start: 0, end: nowMin }]);
    }

    const minutes = sumIntervals(free);
    return { date, weekday, freeHours: round2((minutes / 60) * (1 - FRICTION)) };
  });

  const freePerDay = days.map((d) => d.freeHours);
  const dayIndex = new Map(dayList.map((d, i) => [d, i]));

  const needs = dueTasks
    .filter((t) => t.dueAt)
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
    .map((t) => {
      const dueDate = istDateString(t.dueAt!);
      const idx = dayIndex.get(dueDate);
      return {
        task: t,
        hoursNeeded: hoursNeededFor(t),
        // overdue -> as urgent as it gets (today); beyond the window -> the far end
        dueDayIndex: idx ?? (dueDate < today ? 0 : Math.max(freePerDay.length - 1, 0)),
      };
    });

  const alloc = allocateEarliestDueFirst(
    needs.map((n) => ({ dueDayIndex: n.dueDayIndex, hoursNeeded: n.hoursNeeded })),
    freePerDay,
  );

  const deadlines: PressureDeadline[] = needs.map((n, i) => ({
    taskId: n.task.id,
    title: n.task.title,
    bucketName: n.task.bucketId ? (bucketName.get(n.task.bucketId) ?? null) : null,
    dueAt: n.task.dueAt!.toISOString(),
    dueDate: istDateString(n.task.dueAt!),
    hoursNeeded: round2(n.hoursNeeded),
    hoursAvailable: alloc[i].hoursAvailable,
    ratio: typeof alloc[i].ratio === "number" ? alloc[i].ratio : 999,
    status: alloc[i].status,
  }));

  return {
    now: now.toISOString(),
    horizonDays: HORIZON_DAYS,
    days,
    deadlines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
