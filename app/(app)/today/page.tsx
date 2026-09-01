import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tasks as tasksTable } from "@/db/schema";
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
import { checkDayGeometry } from "@/lib/plan-geometry";
import type { PlanResult } from "@/lib/ai/schemas";
import {
  Ribbon,
  type RibbonBlock,
  type Range,
  type ProtectedRange,
} from "@/components/ribbon/ribbon";
import { OverflowList, type OverflowView } from "@/components/ribbon/overflow-list";
import { PlanActions } from "@/components/today/plan-actions";
import { AddCommitment } from "@/components/today/add-commitment";
import { DayNav } from "@/components/today/day-nav";
import { EnergyCheckin } from "@/components/today/energy-checkin";
import { latestEnergyToday } from "@/lib/energy-db";

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
  const sharpRanges = toRanges(windowsForWeekday(profile.sharpHours, weekday));

  const nowMin = istMinutesOfDay(new Date());
  const inWindow =
    realToday && workRanges.some((r) => nowMin >= r.startMin && nowMin <= r.endMin);

  const live = await getLivePlan(date);
  const latestEnergy = realToday ? await latestEnergyToday() : null;

  const heading = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">
          {formatIst(new Date(`${date}T12:00:00+05:30`), "EEEE d MMMM")}
        </h1>
        <DayNav
          date={date}
          prev={addIstDays(date, -1)}
          next={addIstDays(date, 1)}
          today={istToday()}
          rel={rel}
        />
        <p className="judgment mt-1 text-sm text-ink-muted">
          {isPast && !live ? "Nothing was planned." : null}
          {live
            ? live.plan.status === "committed"
              ? live.plan.debriefedAt
                ? "Day closed."
                : "Committed plan."
              : "Draft plan — review, then commit."
            : "No plan yet."}
        </p>
        {!isPast ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <AddCommitment date={date} />
            {realToday ? <EnergyCheckin latest={latestEnergy} /> : null}
          </div>
        ) : null}
      </div>
      <PlanActions
        date={date}
        readOnly={isPast}
        isToday={realToday}
        status={
          live ? (live.plan.status === "committed" ? "committed" : "draft") : "none"
        }
        planId={live?.plan.id}
        debriefed={!!live?.plan.debriefedAt}
        isRebalance={!!live?.plan.parentPlanId}
        inWindow={inWindow}
      />
    </div>
  );

  if (!live) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <div
          className="border border-rule bg-surface p-6 text-sm text-ink-muted"
          style={{ borderRadius: "var(--radius)" }}
        >
          {isPast ? (
            <>No plan was committed for this day, so there is nothing to show.</>
          ) : (
            <>
              Nothing scheduled. Confirm some tasks in the inbox, then use{" "}
              <span className="text-ink">
                {realToday ? "Plan my day" : "Plan this day"}
              </span>{" "}
              — it reads your active tasks and builds a realistic, time-blocked
              day.
            </>
          )}
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
  const mustDoIds = new Set(
    planTaskIds.length
      ? (
          await db
            .select({ id: tasksTable.id })
            .from(tasksTable)
            .where(
              and(inArray(tasksTable.id, planTaskIds), eq(tasksTable.mustDoToday, true)),
            )
        ).map((r) => r.id)
      : [],
  );

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
  // or its `top` goes negative and the band renders ABOVE the ribbon, covering
  // the page controls (Commit / Re-plan / Discard) and eating their clicks.
  // Sharp hours in particular often start before the first work window or block.
  const starts = [
    ...workRanges.map((r) => r.startMin),
    ...sharpRanges.map((r) => r.startMin),
    ...blocks.map((b) => b.startMin),
  ];
  const ends = [
    ...workRanges.map((r) => r.endMin),
    ...sharpRanges.map((r) => r.endMin),
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

  return (
    <div className="flex flex-col gap-5">
      {heading}

      {debriefSummary ? (
        <p className="judgment border-l-2 border-settled pl-3 text-sm text-ink">
          {debriefSummary}
        </p>
      ) : calibrationNote ? (
        <p className="judgment border-l-2 border-rule pl-3 text-sm text-ink-muted">
          {calibrationNote}
        </p>
      ) : null}

      <Ribbon
        windowStartMin={windowStartMin}
        windowEndMin={windowEndMin}
        workRanges={workRanges}
        sharpRanges={sharpRanges}
        protectedRanges={protectedRanges}
        blocks={blocks}
        isToday={realToday}
        editable={editable}
        initialWarnings={geometryWarnings}
        date={date}
      />

      <OverflowList items={overflowView} />
    </div>
  );
}
