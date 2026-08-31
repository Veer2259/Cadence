"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { istToday } from "@/lib/time";
import { modelFor } from "@/lib/ai/models";
import { StructuredOutputError } from "@/lib/ai/provider";
import { rebalancePlan } from "@/lib/ai/modes/rebalance";
import { saveDraftPlan } from "@/lib/plan";

const inputSchema = z.object({
  account: z.string().trim().max(2000),
  energy: z.enum(["sharp", "ok", "fried"]),
});

export type RebalanceActionResult =
  | { ok: true; planId: string; violations: string[]; retried: boolean }
  | { ok: false; error: string };

export async function rebalanceAction(input: unknown): Promise<RebalanceActionResult> {
  await requireAuth();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read the rebalance form." };

  const date = istToday();
  try {
    const out = await rebalancePlan(date, parsed.data);
    const planId = await saveDraftPlan({
      dateStr: date,
      model: modelFor("compose"),
      input: out.saveInput,
      inputSnapshotOverride: out.payload,
      plan: out.newPlan,
      preservedBlocks: out.preservedBlocks,
      parentPlanId: out.parentPlanId,
    });
    revalidatePath("/today");
    return { ok: true, planId, violations: out.violations, retried: out.retried };
  } catch (e) {
    if (e instanceof StructuredOutputError) return { ok: false, error: e.message };
    const status = (e as { status?: number } | undefined)?.status;
    if (status === 429) return { ok: false, error: "Rate-limited — wait a minute and try again." };
    if (status === 503 || status === 500) return { ok: false, error: "The planner is busy — try again shortly." };
    return { ok: false, error: e instanceof Error ? e.message : "Rebalance failed." };
  }
}
