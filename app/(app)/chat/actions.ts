"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { MustDoOverflowError } from "@/lib/must-do";
import { istToday } from "@/lib/time";
import { modelFor } from "@/lib/ai/models";
import { StructuredOutputError } from "@/lib/ai/provider";
import { DailyQuotaError, dailyQuotaResetHint } from "@/lib/ai/provider";
import { runChat, appendAssistantNote, type PendingAction } from "@/lib/ai/modes/chat";
import { composePlan } from "@/lib/ai/modes/compose";
import { saveDraftPlan, dropPlanBlock } from "@/lib/plan";

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
    if (e instanceof DailyQuotaError) {
      return {
        ok: false,
        error: `Gemini's free daily request limit for ${e.model} is used up — ${dailyQuotaResetHint()}.`,
      };
    }
    if (e instanceof StructuredOutputError) return { ok: false, error: e.message };
    const status = (e as { status?: number } | undefined)?.status;
    if (status === 429) return { ok: false, error: "Rate-limited — try again in a minute." };
    if (status === 503 || status === 500) return { ok: false, error: "The assistant is busy — try again shortly." };
    console.error("[chat]", e);
    return { ok: false, error: "The assistant hit an error." };
  }
}

const confirmSchema = z.object({
  kind: z.enum(["compose", "drop_block"]),
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
    if (parsed.data.kind === "drop_block") {
      const blockId = z.string().uuid().safeParse(parsed.data.params.blockId);
      if (!blockId.success) return { ok: false, error: "Unknown block." };
      const title = String(parsed.data.params.title ?? "the block");
      // The card carries the date the block was found on — a drop confirmed
      // minutes later must land on that day, not on whatever today is.
      const rawDate = parsed.data.params.date;
      const dropDate =
        typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : date;
      const res = await dropPlanBlock({
        dateStr: dropDate,
        blockId: blockId.data,
        reason: "Displaced by an assistant edit — you asked for something else in this slot.",
      });
      if (!res.ok) {
        await appendAssistantNote(`Couldn't drop that: ${res.error}`);
        return { ok: false, error: res.error };
      }
      revalidatePath("/today");
      // Say what LEFT the plan, not just that something happened — a
      // displacement the person cannot see is the same as losing the task.
      const displaced = res.deferredTask
        ? ` "${res.deferredTask}" is now in overflow for today.`
        : "";
      const note = res.violations.length
        ? `Dropped "${title}".${displaced} Heads up: ${res.violations.join("; ")}.`
        : `Dropped "${title}".${displaced}`;
      await appendAssistantNote(note);
      return { ok: true, note, changed: true };
    }

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

    // Only "compose" reaches here now; drop_block is handled above and
    // rebalance no longer exists — the rail replans with adjust_block instead.
    return { ok: false, error: "Unknown action." };
  } catch (e) {
    const msg =
      e instanceof MustDoOverflowError
        ? e.message
        : e instanceof Error
          ? e.message
          : "That action failed.";
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
