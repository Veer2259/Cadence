"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { istToday } from "@/lib/time";
import { modelFor } from "@/lib/ai/models";
import { composePlan } from "@/lib/ai/modes/compose";
import {
  StructuredOutputError,
  ModelBudgetError,
  DailyQuotaError,
  dailyQuotaResetHint,
} from "@/lib/ai/provider";
import {
  getLivePlan,
  saveDraftPlan,
  commitPlan,
  discardDraft,
  applyBlockAdjustment,
} from "@/lib/plan";
import { insertCommitment } from "@/lib/commitments";
import { commitmentInput, flattenIssues } from "@/lib/schemas";
import { recordEnergy } from "@/lib/energy-db";

export type PlanActionResult =
  | { ok: true; planId: string; violations: string[]; retried: boolean }
  | { ok: false; error: string };

function friendlyError(e: unknown): string {
  if (e instanceof DailyQuotaError) {
    return `Gemini's free daily request limit for ${e.model} is used up — ${dailyQuotaResetHint()}. Set GEMINI_COMPOSE_MODEL=gemini-3.5-flash-lite (500/day) to keep going, or wait for the reset.`;
  }
  if (e instanceof ModelBudgetError) {
    return `The planner gave up after ${e.spent} model calls (the model kept rate-limiting or failing). Wait a minute, then try again.`;
  }
  if (e instanceof StructuredOutputError) return e.message;
  const status = (e as { status?: number } | undefined)?.status;
  if (status === 429) {
    return "The planner is rate-limited right now — wait a minute and try again.";
  }
  if (status === 503 || status === 500) {
    return "The planner model is busy right now. Try again in a moment.";
  }
  console.error("[today] compose failed:", e);
  return "Something went wrong building the plan.";
}

export async function planMyDay(): Promise<PlanActionResult> {
  await requireAuth();
  const date = istToday();

  const live = await getLivePlan(date);
  if (live?.plan.status === "committed") {
    return { ok: false, error: "Today already has a committed plan." };
  }

  try {
    const out = await composePlan(date);
    const planId = await saveDraftPlan({
      dateStr: date,
      model: modelFor("compose"),
      input: out.input,
      plan: out.plan,
    });
    revalidatePath("/today");
    return { ok: true, planId, violations: out.violations, retried: out.retried };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const idSchema = z.string().uuid();

export async function commitTodayPlan(planId: string): Promise<PlanActionResult> {
  await requireAuth();
  const id = idSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "Unknown plan." };
  await commitPlan(id.data);
  revalidatePath("/today");
  return { ok: true, planId: id.data, violations: [], retried: false };
}

export async function discardTodayPlan(planId: string): Promise<PlanActionResult> {
  await requireAuth();
  const id = idSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "Unknown plan." };
  await discardDraft(id.data);
  revalidatePath("/today");
  return { ok: true, planId: id.data, violations: [], retried: false };
}

/* ------------------------------------------------------------------ */
/*  Drag-to-adjust — move / resize a block on the live plan           */
/* ------------------------------------------------------------------ */

const adjustSchema = z.object({
  blockId: z.string().uuid(),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(1).max(1440),
});

export type AdjustResult =
  | { ok: true; violations: string[] }
  | { ok: false; error: string };

export async function adjustBlock(input: unknown): Promise<AdjustResult> {
  await requireAuth();
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad block edit." };

  const res = await applyBlockAdjustment({
    dateStr: istToday(),
    blockId: parsed.data.blockId,
    startMin: parsed.data.startMin,
    endMin: parsed.data.endMin,
  });
  if (!res.ok) return res;
  revalidatePath("/today");
  return { ok: true, violations: res.violations };
}

/* ------------------------------------------------------------------ */
/*  One-off fixed commitments                                         */
/* ------------------------------------------------------------------ */

export type CommitmentFormResult = { ok: boolean; errors: string[] };

export async function addCommitment(
  formData: FormData,
): Promise<CommitmentFormResult> {
  await requireAuth();
  const parsed = commitmentInput.safeParse({
    title: formData.get("title"),
    date: formData.get("date") || istToday(),
    start: formData.get("start"),
    end: formData.get("end"),
  });
  if (!parsed.success) return { ok: false, errors: flattenIssues(parsed.error) };

  try {
    await insertCommitment({
      title: parsed.data.title,
      dateStr: parsed.data.date,
      startHm: parsed.data.start,
      endHm: parsed.data.end,
    });
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "Could not save."] };
  }
  revalidatePath("/today");
  return { ok: true, errors: [] };
}

/* ------------------------------------------------------------------ */
/*  Energy check-in                                                    */
/* ------------------------------------------------------------------ */

const energySchema = z.enum(["fried", "ok", "sharp"]);

export type EnergyResult = { ok: boolean; error?: string };

/**
 * Record how sharp you feel right now. Stamped with the current time, because
 * sharp_hours is a claim about hours — one value per day could never tune it.
 */
export async function logEnergy(level: unknown): Promise<EnergyResult> {
  await requireAuth();
  const parsed = energySchema.safeParse(level);
  if (!parsed.success) return { ok: false, error: "Unknown energy level." };
  await recordEnergy(parsed.data, "checkin");
  revalidatePath("/today");
  revalidatePath("/review");
  return { ok: true };
}
