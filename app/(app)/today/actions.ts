"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { istToday } from "@/lib/time";
import { modelFor } from "@/lib/ai/models";
import { composePlan } from "@/lib/ai/modes/compose";
import { StructuredOutputError } from "@/lib/ai/provider";
import {
  getLivePlan,
  saveDraftPlan,
  commitPlan,
  discardDraft,
} from "@/lib/plan";

export type PlanActionResult =
  | { ok: true; planId: string; violations: string[]; retried: boolean }
  | { ok: false; error: string };

function friendlyError(e: unknown): string {
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
