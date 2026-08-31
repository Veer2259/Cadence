"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { istToday } from "@/lib/time";
import { modelFor } from "@/lib/ai/models";
import { StructuredOutputError } from "@/lib/ai/provider";
import { runChat, appendAssistantNote, type PendingAction } from "@/lib/ai/modes/chat";
import { composePlan } from "@/lib/ai/modes/compose";
import { rebalancePlan } from "@/lib/ai/modes/rebalance";
import { saveDraftPlan, getCommittedPlan } from "@/lib/plan";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  pending: PendingAction | null;
};

export type SendResult =
  | { ok: true; assistant: ChatMsg }
  | { ok: false; error: string };

export async function sendChatMessage(content: string): Promise<SendResult> {
  await requireAuth();
  const text = (content ?? "").trim();
  if (text.length < 1) return { ok: false, error: "Say something first." };
  if (text.length > 4000) return { ok: false, error: "That message is too long." };

  try {
    const { assistant, pending } = await runChat(text);
    return {
      ok: true,
      assistant: {
        role: "assistant",
        content: assistant.content,
        createdAt: assistant.createdAt.toISOString(),
        pending,
      },
    };
  } catch (e) {
    if (e instanceof StructuredOutputError) return { ok: false, error: e.message };
    const status = (e as { status?: number } | undefined)?.status;
    if (status === 429) return { ok: false, error: "Rate-limited — try again in a minute." };
    if (status === 503 || status === 500) return { ok: false, error: "The assistant is busy — try again shortly." };
    console.error("[chat]", e);
    return { ok: false, error: "The assistant hit an error." };
  }
}

const confirmSchema = z.object({
  kind: z.enum(["compose", "rebalance"]),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type ConfirmResult =
  | { ok: true; note: string; changed: boolean }
  | { ok: false; error: string };

export async function confirmChatAction(input: unknown): Promise<ConfirmResult> {
  await requireAuth();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad confirmation payload." };

  const date = istToday();
  try {
    if (parsed.data.kind === "compose") {
      const out = await composePlan(date);
      await saveDraftPlan({
        dateStr: date,
        model: modelFor("compose"),
        input: out.input,
        plan: out.plan,
      });
      revalidatePath("/today");
      const note = "Draft plan built — review and commit it on Today.";
      await appendAssistantNote(note);
      return { ok: true, note, changed: true };
    }

    // rebalance
    const account = String(parsed.data.params.account ?? "");
    const energyRaw = String(parsed.data.params.energy ?? "ok");
    const energy = (["sharp", "ok", "fried"].includes(energyRaw) ? energyRaw : "ok") as
      | "sharp"
      | "ok"
      | "fried";
    if (!(await getCommittedPlan(date))) {
      const note = "There's no committed plan to rebalance yet.";
      await appendAssistantNote(note);
      return { ok: true, note, changed: false };
    }
    const out = await rebalancePlan(date, { account, energy });
    await saveDraftPlan({
      dateStr: date,
      model: modelFor("compose"),
      input: out.saveInput,
      inputSnapshotOverride: out.payload,
      plan: out.newPlan,
      preservedBlocks: out.preservedBlocks,
      parentPlanId: out.parentPlanId,
    });
    revalidatePath("/today");
    const note = "Rebalanced — the new draft is on Today. Committing it supersedes the earlier plan.";
    await appendAssistantNote(note);
    return { ok: true, note, changed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "That action failed.";
    await appendAssistantNote(`Couldn't do that: ${msg}`);
    return { ok: false, error: msg };
  }
}

export async function dismissChatAction(): Promise<{ note: string }> {
  await requireAuth();
  const note = "Okay — cancelled, nothing changed.";
  await appendAssistantNote(note);
  return { note };
}
