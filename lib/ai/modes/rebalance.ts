/**
 * lib/ai/modes/rebalance.ts — mid-day replan (SPEC section 6.3).
 *
 * Completed-block preservation is by construction: blocks already marked done or
 * partial are held by the app and never sent for rescheduling. The model plans
 * only [now .. end of window] with the remaining tasks; the app stitches the
 * preserved blocks back in and re-validates the whole day.
 */

import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tasks, habits, commitments, calibration, type Block } from "@/db/schema";
import { getCommittedPlan } from "@/lib/plan";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { applyCalibration, type CategoryRatio } from "@/lib/calibration";
import {
  IST,
  istMinutesOfDay,
  istTimeString,
  istWeekdayKeyForDate,
  minutesToHm,
  windowsForWeekday,
} from "@/lib/time";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { planSchema, type PlanResult } from "@/lib/ai/schemas";
import { REBALANCE_SYSTEM_PROMPT } from "@/lib/ai/prompts/rebalance";
import {
  blockToPlanBlock,
  checkRebalance,
  clampEnd,
  clipFrom,
  type Energy,
} from "@/lib/ai/rebalance-checks";
import type { ComposeInput, ComposeTask } from "@/lib/ai/compose-types";

const DEFAULT_ESTIMATE_MIN = 30;
const REBALANCE_MAX_BLOCK_MIN = 90;

export type { Energy };

export type RebalanceOutcome = {
  /** the rich rebalance payload — stored as input_snapshot */
  payload: Record<string, unknown>;
  /** ComposeInput shape for saveDraftPlan's taskId resolution */
  saveInput: ComposeInput;
  preservedBlocks: Block[];
  /** the model's NEW blocks only, plus overflow + calibrationNote */
  newPlan: PlanResult;
  /** the whole day (preserved + new) — what the ribbon renders */
  combined: PlanResult;
  violations: string[];
  retried: boolean;
  parentPlanId: string;
};

export async function rebalancePlan(
  dateStr: string,
  opts: { account: string; energy: Energy; now?: Date },
): Promise<RebalanceOutcome> {
  const now = opts.now ?? new Date();
  const live = await getCommittedPlan(dateStr);
  if (!live) throw new Error("There is no committed plan to rebalance.");

  const profile = await getOrCreateDayProfile();
  const weekday = istWeekdayKeyForDate(dateStr);
  const dayWindows = windowsForWeekday(profile.workWindows, weekday);
  const daySharp = windowsForWeekday(profile.sharpHours, weekday);

  const preserved = live.blocks.filter(
    (b) => b.status === "done" || b.status === "partial",
  );
  const openBlocks = live.blocks.filter(
    (b) => b.status !== "done" && b.status !== "partial",
  );

  const nowMin = istMinutesOfDay(now);
  const latestPreservedEnd = preserved.reduce((m, b) => Math.max(m, clampEnd(b)), 0);
  const replanFromMin = Math.max(nowMin, latestPreservedEnd);

  const remainingWindows = clipFrom(dayWindows, replanFromMin);
  const remainingSharp = clipFrom(daySharp, replanFromMin);
  const spentMin = preserved.reduce((n, b) => n + (b.actualMin ?? b.estimateMin), 0);
  const remainingCapMin = Math.max(0, profile.dailyCapMin - spentMin);

  // --- calibration ---
  const calRows = await db
    .select()
    .from(calibration)
    .where(eq(calibration.scope, "category"));
  const calByCategory = new Map<string, CategoryRatio>(
    calRows.map((r) => [r.key, { ratio: Number(r.ratio), sampleN: r.sampleN }]),
  );

  // --- remaining tasks: from the open blocks that reference a task ---
  const openTaskIds = [...new Set(openBlocks.filter((b) => b.taskId).map((b) => b.taskId as string))];
  const completedTaskIds = new Set(
    preserved.filter((b) => b.taskId).map((b) => b.taskId as string),
  );
  const taskRows = openTaskIds.length
    ? await db.select().from(tasks).where(inArray(tasks.id, openTaskIds))
    : [];
  const remainingTasks: ComposeTask[] = taskRows
    .filter((t) => t.status === "active" && !completedTaskIds.has(t.id))
    .map((t) => {
      const raw = t.estimateMin ?? DEFAULT_ESTIMATE_MIN;
      const { calibratedMin } = applyCalibration(raw, calByCategory.get(t.category));
      return {
        id: t.id,
        title: t.title,
        bucket: null,
        category: t.category,
        rawEstimateMin: raw,
        calibratedEstimateMin: calibratedMin,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        priority: t.priority,
        deferCount: t.deferCount,
      };
    });

  // --- habits from open habit blocks ---
  const openHabitIds = [...new Set(openBlocks.filter((b) => b.habitId).map((b) => b.habitId as string))];
  const habitRows = openHabitIds.length
    ? await db.select().from(habits).where(inArray(habits.id, openHabitIds))
    : [];

  // --- commitments overlapping the remaining window ---
  const dayCommitments = await db.select().from(commitments);

  const payload = {
    date: dateStr,
    now: now.toISOString(),
    timezone: IST,
    replanFrom: minutesToHm(replanFromMin),
    workWindows: remainingWindows,
    sharpHours: remainingSharp,
    remainingCapMin,
    minBlockMin: profile.minBlockMin,
    maxBlockMin: Math.min(REBALANCE_MAX_BLOCK_MIN, profile.maxBlockMin),
    breakMin: profile.breakMin,
    protectedBlocks: profile.protectedBlocks,
    commitments: dayCommitments.map((c) => ({
      title: c.title,
      start: istTimeString(c.startAt),
      end: istTimeString(c.endAt),
    })),
    preservedBlocks: preserved.map((b) => ({
      title: b.title,
      start: minutesToHm(istMinutesOfDay(b.startAt)),
      end: minutesToHm(clampEnd(b)),
      kind: b.kind,
      category: b.category,
      status: b.status,
    })),
    account: opts.account,
    energy: opts.energy,
    habitsDue: habitRows.map((h) => ({
      name: h.name,
      durationMin: h.durationMin,
      preferredWindow: h.preferredWindow,
    })),
    tasks: remainingTasks,
    calibration: calRows.map((r) => ({
      category: r.key,
      ratio: Number(r.ratio),
      sampleN: r.sampleN,
    })),
  };

  // context for validatePlan — the WHOLE day, so preserved morning blocks pass
  const fullDayContext: ComposeInput = {
    date: dateStr,
    now: now.toISOString(),
    timezone: IST,
    workWindows: dayWindows,
    sharpHours: daySharp,
    dailyCapMin: profile.dailyCapMin,
    minBlockMin: profile.minBlockMin,
    maxBlockMin: profile.maxBlockMin,
    breakMin: profile.breakMin,
    protectedBlocks: profile.protectedBlocks,
    commitments: payload.commitments,
    habitsDue: payload.habitsDue,
    tasks: [
      ...remainingTasks,
      // preserved task blocks reference ids not in `remainingTasks`; add stubs so
      // the taskId-integrity check passes for the combined plan.
      ...preserved
        .filter((b) => b.taskId)
        .map((b): ComposeTask => ({
          id: b.taskId as string,
          title: b.title,
          bucket: null,
          category: b.category,
          rawEstimateMin: b.rawEstimateMin,
          calibratedEstimateMin: b.estimateMin,
          dueAt: null,
          priority: "normal",
          deferCount: 0,
        })),
    ],
    calibration: payload.calibration,
  };

  const preservedPlanBlocks = preserved.map(blockToPlanBlock);
  const userMsg = `Rebalance the rest of the day. Payload:\n\n${JSON.stringify(payload, null, 2)}`;

  const messages: { role: "user" | "model"; content: string }[] = [
    { role: "user", content: userMsg },
  ];

  const budget = new CallBudget(BUDGET.compose, "rebalance");

  let newPlan = await runStructured({
    role: "compose",
    purpose: "rebalance",
    budget,
    system: REBALANCE_SYSTEM_PROMPT,
    schema: planSchema,
    schemaName: "rebalanced_plan",
    messages,
  });

  let violations = checkRebalance(newPlan, {
    preservedPlanBlocks,
    fullDayContext,
    replanFromMin,
    energy: opts.energy,
    completedTaskIds,
  });
  let retried = false;

  if (violations.length && budget.remaining > 0) {
    retried = true;
    newPlan = await runStructured({
      role: "compose",
      purpose: "rebalance:post-validation-retry",
      budget,
      system: REBALANCE_SYSTEM_PROMPT,
      schema: planSchema,
      schemaName: "rebalanced_plan",
      messages: [
        ...messages,
        { role: "model", content: JSON.stringify(newPlan) },
        {
          role: "user",
          content:
            "These checks failed:\n- " +
            violations.join("\n- ") +
            "\n\nReturn the full corrected plan for the remaining window only.",
        },
      ],
    });
    violations = checkRebalance(newPlan, {
      preservedPlanBlocks,
      fullDayContext,
      replanFromMin,
      energy: opts.energy,
      completedTaskIds,
    });
  }

  const combined: PlanResult = {
    blocks: [...preservedPlanBlocks, ...newPlan.blocks],
    overflow: newPlan.overflow,
    calibrationNote: newPlan.calibrationNote,
  };

  return {
    payload,
    saveInput: fullDayContext,
    preservedBlocks: preserved,
    newPlan,
    combined,
    violations,
    retried,
    parentPlanId: live.plan.id,
  };
}
