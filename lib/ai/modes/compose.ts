/**
 * lib/ai/modes/compose.ts — build the compose payload from the database, call
 * the model through the provider, run the in-code post-validation checks, and
 * (once) feed any violations back for a corrected plan.
 *
 * SPEC section 6.1. This module does not persist anything — see lib/plan.ts.
 */

import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, commitments, habits, calibration } from "@/db/schema";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { applyCalibration, isMaterialShift, type CategoryRatio } from "@/lib/calibration";
import {
  IST,
  istWallToUtc,
  istTimeString,
  istWeekdayKeyForDate,
  windowsForWeekday,
  WEEKDAY_KEYS,
} from "@/lib/time";
import { narrowCadence, isHabitDueOn } from "@/lib/habits";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { planSchema, type PlanResult } from "@/lib/ai/schemas";
import { COMPOSE_SYSTEM_PROMPT } from "@/lib/ai/prompts/compose";
import { validatePlan } from "@/lib/ai/validate";
import type {
  ComposeInput,
  ComposeTask,
  ComposeCalibration,
} from "@/lib/ai/compose-types";

/** Fallback when a task has no estimate at all. */
const DEFAULT_ESTIMATE_MIN = 30;

export async function buildComposeInput(dateStr: string): Promise<ComposeInput> {
  const profile = await getOrCreateDayProfile();
  const weekday = istWeekdayKeyForDate(dateStr);
  // The weekdays a habit can be placed on = those with at least one work window.
  const availableWeekdays = WEEKDAY_KEYS.filter(
    (k) => windowsForWeekday(profile.workWindows, k).length > 0,
  );

  // --- calibration (category scope only feeds estimates) ---
  const calRows = await db
    .select()
    .from(calibration)
    .where(eq(calibration.scope, "category"));
  const calByCategory = new Map<string, CategoryRatio>(
    calRows.map((r) => [r.key, { ratio: Number(r.ratio), sampleN: r.sampleN }]),
  );
  const calibrationPayload: ComposeCalibration[] = calRows.map((r) => ({
    category: r.key,
    ratio: Number(r.ratio),
    sampleN: r.sampleN,
  }));

  // --- tasks: active, top-level ---
  const activeTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "active"), isNull(tasks.parentId)));

  const composeTasks: ComposeTask[] = activeTasks.map((t) => {
    const raw = t.estimateMin ?? DEFAULT_ESTIMATE_MIN;
    const { calibratedMin, applied, ratio } = applyCalibration(
      raw,
      calByCategory.get(t.category),
    );
    const task: ComposeTask = {
      id: t.id,
      title: t.title,
      bucket: null, // bucket name is resolved lazily elsewhere; not needed by the planner as an id
      category: t.category,
      rawEstimateMin: raw,
      calibratedEstimateMin: calibratedMin,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      priority: t.priority,
      deferCount: t.deferCount,
    };
    if (applied && isMaterialShift(ratio)) {
      const cal = calByCategory.get(t.category)!;
      task.calibration = {
        category: t.category,
        ratio: Number(ratio.toFixed(2)),
        deltaPct: Math.round((ratio - 1) * 100),
        sampleN: cal.sampleN,
      };
    }
    return task;
  });

  // --- commitments overlapping the IST day ---
  const dayStart = istWallToUtc(dateStr, "00:00");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayCommitments = await db.select().from(commitments);
  const commitmentPayload = dayCommitments
    .filter((c) => c.startAt < dayEnd && c.endAt > dayStart)
    .map((c) => ({
      title: c.title,
      start: istTimeString(c.startAt),
      end: istTimeString(c.endAt),
    }));

  // --- habits due today ---
  const activeHabits = await db
    .select()
    .from(habits)
    .where(eq(habits.active, true));
  const habitPayload = activeHabits
    .filter((h) => isHabitDueOn(narrowCadence(h.cadence), weekday, availableWeekdays))
    .map((h) => ({
      id: h.id,
      name: h.name,
      durationMin: h.durationMin,
      preferredWindow: h.preferredWindow,
    }));

  return {
    date: dateStr,
    now: new Date().toISOString(),
    timezone: IST,
    workWindows: windowsForWeekday(profile.workWindows, weekday),
    sharpHours: windowsForWeekday(profile.sharpHours, weekday),
    dailyCapMin: profile.dailyCapMin,
    minBlockMin: profile.minBlockMin,
    maxBlockMin: profile.maxBlockMin,
    breakMin: profile.breakMin,
    protectedBlocks: profile.protectedBlocks,
    commitments: commitmentPayload,
    habitsDue: habitPayload,
    tasks: composeTasks,
    calibration: calibrationPayload,
  };
}

export type ComposeOutcome = {
  input: ComposeInput;
  plan: PlanResult;
  /** Empty when the plan passed every in-code check. */
  violations: string[];
  /** True when a second model round was needed to fix violations. */
  retried: boolean;
};

const USER_INSTRUCTION = [
  "Here is today's planning payload as JSON. Produce the time-blocked plan.",
  "",
  "Any task with a `calibration` object is one where this person's history moved",
  "the estimate materially. Schedule with `calibratedEstimateMin`, and the reason",
  "line for that block MUST name the shift in plain language, e.g. \"1h planned,",
  "1h25 scheduled — you run ~40% over on deep work\" (use its category and deltaPct).",
  "",
  "Every entry in `habitsDue` MUST appear in the plan as a block with kind",
  "\"habit\", `title` set to the habit's exact `name`, and length `durationMin`.",
  "Habits are personal, not work: unlike tasks, a habit block MAY sit outside the",
  "working windows — put it in its `preferredWindow` when one is given (a clock",
  "range, or a word like \"evening\"), even if that is before or after the working",
  "day. A habit must still not overlap another block, a fixed commitment, or a",
  "protected block. Never put a habit in `overflow` and never drop one: overflow",
  "is for tasks only.",
].join("\n");

export async function composePlan(dateStr: string): Promise<ComposeOutcome> {
  const input = await buildComposeInput(dateStr);
  const payloadJson = JSON.stringify(input, null, 2);

  // One hard ceiling across the initial call, its Zod retry, and the
  // post-validation retry below: at most BUDGET.compose (3) outbound calls.
  const budget = new CallBudget(BUDGET.compose, "compose");

  let plan = await runStructured({
    role: "compose",
    purpose: "compose",
    budget,
    system: COMPOSE_SYSTEM_PROMPT,
    schema: planSchema,
    schemaName: "day_plan",
    messages: [{ role: "user", content: `${USER_INSTRUCTION}\n\n${payloadJson}` }],
  });

  let violations = validatePlan(plan, input);
  let retried = false;

  if (violations.length > 0 && budget.remaining > 0) {
    retried = true;
    plan = await runStructured({
      role: "compose",
      purpose: "compose:post-validation-retry",
      budget,
      system: COMPOSE_SYSTEM_PROMPT,
      schema: planSchema,
      schemaName: "day_plan",
      messages: [
        { role: "user", content: `${USER_INSTRUCTION}\n\n${payloadJson}` },
        { role: "model", content: JSON.stringify(plan) },
        {
          role: "user",
          content:
            "These checks failed on that plan:\n- " +
            violations.join("\n- ") +
            "\n\nReturn the full corrected plan as JSON. Do not compress estimates " +
            "to make things fit — move the surplus into `overflow` instead.",
        },
      ],
    });
    violations = validatePlan(plan, input);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[ai]   compose finished — ${budget.spent}/${budget.max} calls used`);
  }

  return { input, plan, violations, retried };
}
