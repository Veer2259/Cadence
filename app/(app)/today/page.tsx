import { desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { plans, tasks as tasksTable, buckets as bucketsTable } from "@/db/schema";
import {
  formatIst,
  istMinutesOfDay,
  istToday,
  istWeekdayKeyForDate,
  windowsForWeekday,
  hmToMinutes,
  addIstDays,
  compareToToday,
} from "@/lib/time";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { getLivePlan, buildGeometryContext } from "@/lib/plan";
import { learnedFocusWindows } from "@/lib/focus-db";
import { checkDayGeometry } from "@/lib/plan-geometry";
import { streakEndingYesterday, longestStreak, recentDays } from "@/lib/streak";
import type { PlanResult } from "@/lib/ai/schemas";
import type { RibbonBlock, Range, ProtectedRange } from "@/components/ribbon/ribbon";
import { DayView } from "@/components/today/day-view";
import { OverflowList, type OverflowView } from "@/components/ribbon/overflow-list";
import { PlanActions } from "@/components/today/plan-actions";
import { AddCommitment } from "@/components/today/add-commitment";
import { DayNav } from "@/components/today/day-nav";
import { EnergyCheckin } from "@/components/today/energy-checkin";
import { CapacityRing } from "@/components/today/capacity-ring";
import { MomentumCard, type MomentumBlock } from "@/components/today/momentum-card";
import { StreakCard } from "@/components/today/streak-card";
import { latestEnergyToday } from "@/lib/energy-db";

/**
 * Server Actions inherit maxDuration from the PAGE segment they are invoked
 * from, not from the file they live in (Next.js route-segment config).
 * Covers compose — "Plan my day" and "Re-plan".
 *
 * 300s is the Fluid compute ceiling on Vercel's Hobby plan. It is a ceiling,
 * not a reservation: a fast call still costs only what it uses.
 */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

function toRanges(windows: [string, string][]): Range[] {
  return windows.map(([a, b]) => ({
    startMin: hmToMinutes(a),
    endMin: hmToMinutes(b),
  }));
}

/** Protected blocks clipped to the visible ribbon window, splitting midnight wraps. */
function protectedRangesInWindow(
  blocks: { label: string; start: string; end: string }[],
  winStart: number,
  winEnd: number,
): ProtectedRange[] {
  const out: ProtectedRange[] = [];
  for (const p of blocks) {
    let s: number;
    let e: number;
    try {
      s = hmToMinutes(p.start);
      e = hmToMinutes(p.end);
    } catch {
      continue;
    }
    const segments = e > s ? [[s, e]] : [[s, 1440], [0, e]];
    for (const [a, z] of segments) {
      const cs = Math.max(a, winStart);
      const ce = Math.min(z, winEnd);
      if (ce - cs >= 5) out.push({ label: p.label, startMin: cs, endMin: ce });
    }
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function StatTile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex-1 rounded-2xl bg-tint px-3 py-2.5">
      <p className="text-[10px] font-bold tracking-[0.1em] text-ink-soft uppercase">
        {label}
      </p>
      <p
        className={`tabular mt-0.5 text-[16px] font-extrabold ${emphasis ? "text-primary" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

const hoursLabel = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.date === "string" ? sp.date : undefined;
  const date = raw && DATE_RE.test(raw) ? raw : istToday();

  // Which day is this relative to now? Drives everything below: only today gets
  // the now-line and the energy check-in, and only a past day is read-only.
  const rel = compareToToday(date);
  const realToday = rel === 0;
  const isPast = rel === -1;

  const profile = await getOrCreateDayProfile();
  const weekday = istWeekdayKeyForDate(date);
  const workWindows = windowsForWeekday(profile.workWindows, weekday);
  const workRanges = toRanges(workWindows);
  // Learned focus hours — empty until there is enough history, and that is the
  // honest state rather than a default morning band.
  const focusRanges = toRanges((await learnedFocusWindows()).windows);

  const nowMin = istMinutesOfDay(new Date());

  const live = await getLivePlan(date);
  const latestEnergy = realToday ? await latestEnergyToday() : null;

  // The streak: closed days ending yesterday. See lib/streak.ts for why today
  // is excluded.
  const closedRows = await db
    .select({ date: plans.date })
    .from(plans)
    .where(isNotNull(plans.debriefedAt))
    .orderBy(desc(plans.date));
  const closedDates = closedRows.map((r) => r.date);
  const streak = streakEndingYesterday(closedDates, istToday());
  const best = longestStreak(closedDates);
  const week = recentDays(closedDates, istToday());

  const header = (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[12px] font-bold tracking-[0.14em] text-primary uppercase">
          {formatIst(new Date(`${date}T12:00:00+05:30`), "EEEE")}
        </p>
        <h1 className="mt-0.5 text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          {formatIst(new Date(`${date}T12:00:00+05:30`), "d MMMM")}
        </h1>
        <div className="mt-2">
          <DayNav
            date={date}
            prev={addIstDays(date, -1)}
            next={addIstDays(date, 1)}
            today={istToday()}
            rel={rel}
          />
        </div>
      </div>
      {live ? (
        <CapacityRing
          plannedMin={live.blocks
            .filter((b) => b.kind === "task" || b.kind === "habit")
            .reduce((n, b) => n + (istMinutesOfDay(b.endAt) - istMinutesOfDay(b.startAt)), 0)}
          capMin={profile.dailyCapMin}
        />
      ) : null}
    </header>
  );

  if (!live) {
    return (
      <div className="animate-rise-in flex flex-col gap-2.5">
        {header}
        <div className="mt-1">
          <StreakCard streak={streak} best={best} week={week} loggedLabel={null} />
        </div>
        <div className="mt-1 rounded-[22px] bg-surface p-5 text-[14px] leading-[1.5] font-medium text-ink-muted shadow-card">
          {isPast ? (
            <>No plan was committed for this day, so there is nothing to show.</>
          ) : (
            <>
              Nothing scheduled. Confirm some tasks in the inbox, then use{" "}
              <span className="font-bold text-ink">
                {realToday ? "Plan my day" : "Plan this day"}
              </span>{" "}
              — it reads your active tasks and builds a realistic, time-blocked day.
            </>
          )}
        </div>
        <div className="mt-1">
          <PlanActions
            date={date}
            readOnly={isPast}
            isToday={realToday}
            status="none"
          />
        </div>
      </div>
    );
  }

  const output = (live.plan.outputSnapshot ?? null) as PlanResult | null;
  const calibrationNote = output?.calibrationNote ?? null;
  const debriefSummary = live.plan.debriefedAt ? live.plan.debriefSummary : null;

  // Which of this plan's tasks are flagged must-do-today, so the ribbon can
  // mark them distinctly. One query, not one per block.
  const planTaskIds = [
    ...new Set(live.blocks.filter((b) => b.taskId).map((b) => b.taskId as string)),
  ];
  const taskRows = planTaskIds.length
    ? await db
        .select({
          id: tasksTable.id,
          mustDoToday: tasksTable.mustDoToday,
          deferCount: tasksTable.deferCount,
          bucketId: tasksTable.bucketId,
        })
        .from(tasksTable)
        .where(inArray(tasksTable.id, planTaskIds))
    : [];
  const mustDoIds = new Set(taskRows.filter((r) => r.mustDoToday).map((r) => r.id));
  const taskById = new Map(taskRows.map((r) => [r.id, r]));

  const bucketRows = await db
    .select({ id: bucketsTable.id, name: bucketsTable.name })
    .from(bucketsTable);
  const bucketName = new Map(bucketRows.map((b) => [b.id, b.name]));

  // --- ribbon geometry ---
  const blocks: RibbonBlock[] = live.blocks.map((b) => {
    const startMin = istMinutesOfDay(b.startAt);
    let endMin = istMinutesOfDay(b.endAt);
    if (endMin <= startMin) endMin = 1440; // crossed midnight — clamp to end of day
    return {
      id: b.id,
      title: b.title,
      startMin,
      endMin,
      kind: b.kind,
      category: b.category,
      reason: b.reason,
      estimateMin: b.estimateMin,
      status: b.status,
      mustDoToday: b.taskId ? mustDoIds.has(b.taskId) : false,
    };
  });

  // Every layer the ribbon paints must be inside [windowStartMin, windowEndMin],
  // or its `top` goes negative and the band renders ABOVE the ribbon.
  const starts = [
    ...workRanges.map((r) => r.startMin),
    ...focusRanges.map((r) => r.startMin),
    ...blocks.map((b) => b.startMin),
  ];
  const ends = [
    ...workRanges.map((r) => r.endMin),
    ...focusRanges.map((r) => r.endMin),
    ...blocks.map((b) => b.endMin),
  ];
  const windowStartMin = starts.length ? Math.min(...starts) : 6 * 60;
  const windowEndMin = ends.length ? Math.max(...ends) : 22 * 60;

  const protectedRanges = protectedRangesInWindow(
    profile.protectedBlocks,
    windowStartMin,
    windowEndMin,
  );

  // Positional checks over the plan as it stands now — so a manual drag that
  // broke something still shows the warning after a reload, not just on drop.
  // A past day is a record, not a plan: no dragging, no logging, no edits.
  const editable = !isPast && !live.plan.debriefedAt;
  const geometryWarnings = editable
    ? checkDayGeometry(
        blocks.map((b) => ({
          startMin: b.startMin,
          endMin: b.endMin,
          kind: b.kind,
          title: b.title,
        })),
        await buildGeometryContext(date),
      )
    : [];

  // --- overflow titles ---
  let overflowView: OverflowView[] = [];
  if (live.overflow.length) {
    const ids = live.overflow.map((o) => o.taskId);
    const rows = await db
      .select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(inArray(tasksTable.id, ids));
    const titleById = new Map(rows.map((r) => [r.id, r.title]));
    overflowView = live.overflow.map((o) => ({
      id: o.id,
      title: titleById.get(o.taskId) ?? "(unknown task)",
      reason: o.reason,
      action: o.action,
      suggestion: o.suggestion,
    }));
  }

  // --- the stat tiles + momentum block ---
  const plannedMin = blocks
    .filter((b) => b.kind === "task" || b.kind === "habit")
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
  const loggableBlocks = blocks.filter((b) => b.kind !== "break");
  const loggedCount = loggableBlocks.filter((b) => b.status !== "planned").length;
  const freeMin = Math.max(0, profile.dailyCapMin - plannedMin);

  const currentSrc = realToday
    ? live.blocks.find((b) => {
        const s = istMinutesOfDay(b.startAt);
        const e = istMinutesOfDay(b.endAt);
        return b.kind !== "break" && nowMin >= s && nowMin < e;
      })
    : undefined;
  const current: MomentumBlock | null = currentSrc
    ? {
        id: currentSrc.id,
        title: currentSrc.title,
        startMin: istMinutesOfDay(currentSrc.startAt),
        endMin: istMinutesOfDay(currentSrc.endAt),
        bucket: currentSrc.taskId
          ? (bucketName.get(taskById.get(currentSrc.taskId)?.bucketId ?? "") ?? null)
          : null,
        deferCount: currentSrc.taskId
          ? (taskById.get(currentSrc.taskId)?.deferCount ?? 0)
          : 0,
        status: currentSrc.status,
      }
    : null;

  return (
    <div className="animate-rise-in flex flex-col gap-2.5">
      {header}

      <StreakCard
        streak={streak}
        best={best}
        week={week}
        loggedLabel={`${loggedCount} of ${loggableBlocks.length} blocks logged today`}
      />

      <div className="flex gap-2.5">
        <StatTile label="Planned" value={hoursLabel(plannedMin)} />
        <StatTile label="Free" value={hoursLabel(freeMin)} emphasis />
        <StatTile label="Logged" value={`${loggedCount} / ${loggableBlocks.length}`} />
      </div>

      {realToday && editable ? (
        <MomentumCard block={current} date={date} hasPlan />
      ) : null}

      {realToday && editable ? <EnergyCheckin latest={latestEnergy} /> : null}

      {debriefSummary ? (
        <p className="rounded-[18px] bg-primary-tint px-4 py-3 text-[14px] leading-[1.5] font-semibold text-primary-deep">
          {debriefSummary}
        </p>
      ) : calibrationNote ? (
        <p className="rounded-[18px] bg-surface px-4 py-3 text-[14px] leading-[1.5] font-medium text-ink-muted shadow-card">
          {calibrationNote}
        </p>
      ) : null}

      <div className="mt-1">
        <PlanActions
          date={date}
          readOnly={isPast}
          isToday={realToday}
          status={live.plan.status === "committed" ? "committed" : "draft"}
          planId={live.plan.id}
          debriefed={!!live.plan.debriefedAt}
        />
      </div>

      {!isPast ? <AddCommitment date={date} /> : null}

      <div className="mt-2">
        <DayView
          windowStartMin={windowStartMin}
          windowEndMin={windowEndMin}
          focusRanges={focusRanges}
          protectedRanges={protectedRanges}
          blocks={blocks}
          isToday={realToday}
          editable={editable}
          initialWarnings={geometryWarnings}
          date={date}
        />
      </div>

      <OverflowList items={overflowView} />
    </div>
  );
}
