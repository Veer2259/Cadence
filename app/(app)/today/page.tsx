import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { tasks as tasksTable } from "@/db/schema";
import {
  formatIst,
  istMinutesOfDay,
  istToday,
  istWeekdayKeyForDate,
  windowsForWeekday,
  hmToMinutes,
} from "@/lib/time";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { getLivePlan } from "@/lib/plan";
import type { PlanResult } from "@/lib/ai/schemas";
import {
  Ribbon,
  type RibbonBlock,
  type Range,
  type ProtectedRange,
} from "@/components/ribbon/ribbon";
import { OverflowList, type OverflowView } from "@/components/ribbon/overflow-list";
import { PlanActions } from "@/components/today/plan-actions";

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

export default async function TodayPage() {
  const date = istToday();
  const realToday = true; // this screen always plans the current IST day
  const profile = await getOrCreateDayProfile();
  const weekday = istWeekdayKeyForDate(date);
  const workRanges = toRanges(windowsForWeekday(profile.workWindows, weekday));
  const sharpRanges = toRanges(windowsForWeekday(profile.sharpHours, weekday));

  const live = await getLivePlan(date);

  const heading = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">
          {formatIst(new Date(), "EEEE d MMMM")}
        </h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          {live
            ? live.plan.status === "committed"
              ? live.plan.debriefedAt
                ? "Day closed."
                : "Committed plan."
              : "Draft plan — review, then commit."
            : "No plan yet."}
        </p>
      </div>
      <PlanActions
        status={
          live ? (live.plan.status === "committed" ? "committed" : "draft") : "none"
        }
        planId={live?.plan.id}
        debriefed={!!live?.plan.debriefedAt}
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
          Nothing scheduled. Confirm some tasks in the inbox, then use{" "}
          <span className="text-ink">Plan my day</span> — it reads your active
          tasks and builds a realistic, time-blocked day.
        </div>
      </div>
    );
  }

  const output = (live.plan.outputSnapshot ?? null) as PlanResult | null;
  const calibrationNote = output?.calibrationNote ?? null;
  const debriefSummary = live.plan.debriefedAt ? live.plan.debriefSummary : null;

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
    };
  });

  const starts = [
    ...workRanges.map((r) => r.startMin),
    ...blocks.map((b) => b.startMin),
  ];
  const ends = [
    ...workRanges.map((r) => r.endMin),
    ...blocks.map((b) => b.endMin),
  ];
  const windowStartMin = starts.length ? Math.min(...starts) : 6 * 60;
  const windowEndMin = ends.length ? Math.max(...ends) : 22 * 60;

  const protectedRanges = protectedRangesInWindow(
    profile.protectedBlocks,
    windowStartMin,
    windowEndMin,
  );

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
      />

      <OverflowList items={overflowView} />
    </div>
  );
}
