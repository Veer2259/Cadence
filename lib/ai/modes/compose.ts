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
} from "@/lib/time";
import { runStructured } from "@/lib/ai/provider";
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

function habitDueOn(cadence: string, weekday: string): boolean {
  const c = cadence.trim().toLowerCase();
  if (c === "daily" || c === "every day") return true;
  if (/^\s*\d+\s*x\s*\/\s*week/.test(c)) return true; // Nx/week — let the planner weigh it
  return c
    .split(/[,\s]+/)
    .map((s) => s.slice(0, 3))
    .includes(weekday);
}

export async function buildComposeInput(dateStr: string): Promise<ComposeInput> {
  const profile = await getOrCreateDayProfile();
  const weekday = istWeekdayKeyForDate(dateStr);

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
    .filter((h) => habitDueOn(h.cadence, weekday))
    .map((h) => ({
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
].join("\n");

export async function composePlan(dateStr: string): Promise<ComposeOutcome> {
  const input = await buildComposeInput(dateStr);
  const payloadJson = JSON.stringify(input, null, 2);

  let plan = await runStructured({
    role: "compose",
    system: COMPOSE_SYSTEM_PROMPT,
    schema: planSchema,
    schemaName: "day_plan",
    messages: [{ role: "user", content: `${USER_INSTRUCTION}\n\n${payloadJson}` }],
  });

  let violations = validatePlan(plan, input);
  let retried = false;

  if (violations.length > 0) {
    retried = true;
    plan = await runStructured({
      role: "compose",
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

  return { input, plan, violations, retried };
}
