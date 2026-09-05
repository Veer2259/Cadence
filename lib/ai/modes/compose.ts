/**
 * lib/ai/modes/compose.ts — build the compose payload from the database, call
 * the model through the provider, run the in-code post-validation checks, and
 * (once) feed any violations back for a corrected plan.
 *
 * SPEC section 6.1. This module does not persist anything — see lib/plan.ts.
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, commitments, habits, calibration } from "@/db/schema";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { emphasisFor } from "@/lib/emphasis";
import { applyCalibration, isMaterialShift, type CategoryRatio } from "@/lib/calibration";
import {
  IST,
  istWallToUtc,
  istTimeString,
  istToday,
  istMinutesOfDay,
  istWeekdayKeyForDate,
  windowsForWeekday,
  clipFrom,
  WEEKDAY_KEYS,
} from "@/lib/time";
import { narrowCadence, isHabitDueOn } from "@/lib/habits";
import { learnedFocusWindows } from "@/lib/focus-db";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { planSchema, type PlanResult } from "@/lib/ai/schemas";
import { COMPOSE_SYSTEM_PROMPT } from "@/lib/ai/prompts/compose";
import { validatePlan } from "@/lib/ai/validate";
import { checkMustDoFit, MustDoOverflowError, type MustDoTask } from "@/lib/must-do";
import { weeklyTargetsFor, weekStartOf } from "@/lib/goals";
import { goalPressure } from "@/lib/goal-pressure";
import type {
  ComposeInput,
  ComposeTask,
  ComposeCalibration,
} from "@/lib/ai/compose-types";

/** Fallback when a task has no estimate at all. */
const DEFAULT_ESTIMATE_MIN = 30;

export async function buildComposeInput(
  dateStr: string,
  now: Date = new Date(),
): Promise<ComposeInput> {
  const profile = await getOrCreateDayProfile();
  // What the person said matters most today. A preference — see lib/emphasis.ts.
  const emphasis = await emphasisFor(dateStr);
  const weekday = istWeekdayKeyForDate(dateStr);
  // Learned from history, not declared. Empty until there is real evidence.
  const focus = await learnedFocusWindows();

  // Composing TODAY mid-day must not schedule into hours that have already
  // gone. Planning a future date starts from midnight as normal.
  const planFromMin = dateStr === istToday(now) ? istMinutesOfDay(now) : 0;
  // The weekdays a habit can be placed on = those with at least one work window.
  const availableWeekdays = WEEKDAY_KEYS.filter(
    (k) => windowsForWeekday(profile.workWindows, k).length > 0,
  );

  // --- calibration (category scope only feeds estimates) ---
  const calRows = await db
    .select()
    .from(calibration)
  const calByCategory = new Map<string, CategoryRatio>(
    calRows.map((r) => [r.key, { ratio: Number(r.ratio), sampleN: r.sampleN }]),
  );
  const calibrationPayload: ComposeCalibration[] = calRows.map((r) => ({
    category: r.key,
    ratio: Number(r.ratio),
    sampleN: r.sampleN,
  }));

  // --- goal pressure: which of this week's targets are behind pace ---
  // Only targets that are actually behind produce a payload entry; an on-track
  // target says nothing, so the planner is not nudged by noise.
  const weekStart = weekStartOf(dateStr);
  const dayIndexInWeek = Math.round(
    (Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) /
      86_400_000,
  );
  const targets = await weeklyTargetsFor(weekStart);
  const behindByTarget = new Map<string, NonNullable<ComposeTask["goal"]>>();
  for (const tg of targets) {
    const gp = goalPressure({
      targetHours: tg.targetHours,
      actualHours: tg.actualHours,
      totalTasks: tg.totalTasks,
      doneTasks: tg.doneTasks,
      dayIndexInWeek,
    });
    if (gp.note && (gp.state === "behind" || gp.state === "slipping")) {
      behindByTarget.set(tg.id, {
        bucket: tg.bucketName,
        target: tg.description,
        state: gp.state,
        note: gp.note,
      });
    }
  }

  // --- tasks: active, top-level ---
  const activeTasks = await db
    .select()
    .from(tasks)

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
      deferCount: t.deferCount,
      mustDoToday: t.mustDoToday,
    };
    const goal = t.weeklyTargetId ? behindByTarget.get(t.weeklyTargetId) : undefined;
    if (goal) task.goal = goal;
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
    now: now.toISOString(),
    timezone: IST,
    planFromMin,
    workWindows: clipFrom(windowsForWeekday(profile.workWindows, weekday), planFromMin),
    focusHours: clipFrom(focus.windows, planFromMin),
    focusHoursKnown: focus.hasEvidence,
    dailyCapMin: profile.dailyCapMin,
    minBlockMin: profile.minBlockMin,
    maxBlockMin: profile.maxBlockMin,
    breakMin: profile.breakMin,
    protectedBlocks: profile.protectedBlocks,
    commitments: commitmentPayload,
    habitsDue: habitPayload,
    tasks: composeTasks,
    calibration: calibrationPayload,
    // Absent entirely when nothing was emphasised — "no view" is a real state,
    // and an empty list would read as "no bucket matters".
    ...(emphasis ? { bucketEmphasis: { buckets: emphasis.bucketNames, note: emphasis.note } } : {}),
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
"`focusHours` are LEARNED from this person's own history, not declared, and they",
  "are a PREFERENCE, never a constraint. Wherever rule 3 says \"sharp hours\", read",
  "`focusHours`. Prefer them for deep work, but when there is more deep work than",
  "focus time inside the working windows — which is common — schedule the surplus",
  "outside them and say so in the reason. NEVER defer a task for want of focus",
  "hours while ordinary working time is still free.",
  "",
  "When `focusHoursKnown` is false there is not yet enough history to know when",
  "this person focuses well. Do NOT assume mornings or any other default. Place",
  "deep work on the other signals alone — deadline pressure, must-do, defer",
  "count and goal pressure — and say plainly in the calibrationNote that focus",
  "hours are not yet known, so placement used deadlines instead.",
  "",
  "Before putting anything in `overflow`, total the unscheduled minutes left in",
  "the working windows. If the task fits in that time it is NOT overflow, whatever",
  "else is imperfect about the slot. `overflow` means there is genuinely no room,",
  "and the reason must name which hours are full.",
  "",
  "`bucketEmphasis`, when present, is what this person said matters most TODAY,",
  "in order, most emphasised first. It is a PREFERENCE and nothing more. Use it",
  "to break ties and to order placement when two pieces of work compete for the",
  "same slot, and prefer an emphasised bucket for the better hours.",
  "",
  "It must NEVER cause a task to be deferred or put in `overflow` while any",
  "working minutes are still unscheduled. A less-emphasised task placed in a",
  "worse slot is a correct outcome; a less-emphasised task dropped from a day",
  "that still has free time is a bug. Emphasis also never outranks",
  "`mustDoToday`, which stays a hard constraint.",
  "",
  "A task carrying a `goal` object belongs to a weekly target that is behind",
  "pace. Weigh that alongside its deadline and deferCount when ordering the day —",
  "it is evidence, not a rule, and it never outranks a hard constraint. If it",
  "changes where you put the block, say why in the reason using the numbers given.",
  "",
  "A task with `mustDoToday: true` is a HARD constraint. It must appear as a",
  "block in `blocks`. Putting one in `overflow` is not an option — the app has",
  "already checked they fit in the time available, so if you cannot place one you",
  "have made an arithmetic error. Place must-do tasks first, then fill around them.",
  "",
  "`planFromMin` is the earliest minute-of-day you may schedule anything at (it is",
  "the current time when planning today). Never place a block before it — those",
  "hours are already gone. The working windows you were given are already clipped.",
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

  // Do the must-do tasks fit in what is left of today? Answered in code, before
  // spending a model call — so "these do not fit" is arithmetic we can show,
  // never the planner quietly deferring one.
  const mustDo: MustDoTask[] = input.tasks
    .filter((t) => t.mustDoToday)
    .map((t) => ({ id: t.id, title: t.title, minutes: t.calibratedEstimateMin }));
  if (mustDo.length) {
    const fit = checkMustDoFit({
      tasks: mustDo,
      windows: input.workWindows,
      cuts: [
        ...input.commitments.map((x) => [x.start, x.end] as [string, string]),
        ...input.protectedBlocks.map((x) => [x.start, x.end] as [string, string]),
      ],
      dailyCapMin: input.dailyCapMin,
    });
    if (!fit.fits) throw new MustDoOverflowError(fit);
  }

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
