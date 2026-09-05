"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { MustDoOverflowError } from "@/lib/must-do";
import { istToday, istEndOfDayToUtc } from "@/lib/time";
import { modelFor } from "@/lib/ai/models";
import { StructuredOutputError } from "@/lib/ai/provider";
import { DailyQuotaError, dailyQuotaResetHint } from "@/lib/ai/provider";
import { runChat, appendAssistantNote, type PendingAction } from "@/lib/ai/modes/chat";
import { composePlan } from "@/lib/ai/modes/compose";
import {
  saveDraftPlan,
  dropPlanBlock,
  getLivePlan,
  commitPlan,
  discardDraft,
} from "@/lib/plan";
import { submitDebrief } from "@/lib/debrief";
import { insertTask } from "@/lib/tasks";

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
  kind: z.enum([
    "compose",
    "drop_block",
    "capture_tasks",
    "commit_plan",
    "discard_plan",
    "close_day",
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type ConfirmResult =
  | { ok: true; note: string; changed: boolean }
  | { ok: false; error: string };

/** The task list on a capture card, as the person may have edited it. */
const capturedTasks = z
  .array(
    z.object({
      title: z.string().trim().min(1).max(200),
      notes: z.string().nullish(),
      bucketName: z.string().nullish(),
      category: z.enum(["deep", "shallow", "admin"]),
      estimateMin: z.number().int().min(1).max(1440).nullish(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }),
  )
  .max(50);

const closeDayEntries = z
  .array(
    z.object({
      blockTitleContains: z.string().min(1),
      status: z.enum(["done", "partial", "skipped"]),
      actualMin: z.number().int().min(0).max(1440).nullish(),
    }),
  )
  .max(60);

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

    if (parsed.data.kind === "capture_tasks") {
      // Capture PROPOSES; this is the moment the person accepted it. The list
      // comes from the card, which they may have edited — never from the model
      // output directly (SPEC 6.2).
      const rows = capturedTasks.safeParse(parsed.data.params.tasks);
      if (!rows.success) return { ok: false, error: "Could not read those tasks." };
      for (const t of rows.data) {
        await insertTask({
          title: t.title,
          notes: t.notes ?? null,
          bucketName: t.bucketName ?? null,
          category: t.category,
          estimateMin: t.estimateMin ?? null,
          dueAt: t.dueDate ? istEndOfDayToUtc(t.dueDate) : null,
          status: "inbox",
          source: "dump",
        });
      }
      revalidatePath("/inbox");
      const note = `Captured ${rows.data.length} task${rows.data.length === 1 ? "" : "s"} to the inbox.`;
      await appendAssistantNote(note);
      return { ok: true, note, changed: true };
    }

    if (parsed.data.kind === "commit_plan") {
      const planId = z.string().uuid().safeParse(parsed.data.params.planId);
      if (!planId.success) return { ok: false, error: "Unknown plan." };
      await commitPlan(planId.data);
      revalidatePath("/today");
      const note = "Committed. The day is live — log blocks as you go.";
      await appendAssistantNote(note);
      return { ok: true, note, changed: true };
    }

    if (parsed.data.kind === "discard_plan") {
      const planId = z.string().uuid().safeParse(parsed.data.params.planId);
      if (!planId.success) return { ok: false, error: "Unknown plan." };
      await discardDraft(planId.data);
      revalidatePath("/today");
      const note = "Draft discarded.";
      await appendAssistantNote(note);
      return { ok: true, note, changed: true };
    }

    if (parsed.data.kind === "close_day") {
      const planId = z.string().uuid().safeParse(parsed.data.params.planId);
      if (!planId.success) return { ok: false, error: "Unknown plan." };
      const rawDate = parsed.data.params.date;
      const day =
        typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : date;

      const live = await getLivePlan(day);
      if (!live) return { ok: false, error: "That day has no plan." };

      // Resolve the model's title fragments to real block ids here, not in the
      // tool: the card may sit for minutes, and the plan can move underneath it.
      const asked = closeDayEntries.safeParse(parsed.data.params.entries ?? []);
      if (!asked.success) return { ok: false, error: "Could not read those entries." };
      const byId = new Map<string, { status: "done" | "partial" | "skipped"; actualMin: number | null }>();
      for (const e of asked.data) {
        const m = live.blocks.filter((b) =>
          b.title.toLowerCase().includes(e.blockTitleContains.toLowerCase()),
        );
        if (m.length === 1) {
          byId.set(m[0].id, { status: e.status, actualMin: e.actualMin ?? null });
        }
      }

      // Anything not mentioned is logged as done at its planned length — the
      // same default the debrief screen uses (SPEC 6.4).
      const entries = live.blocks
        .filter((b) => b.kind !== "break")
        .map((b) => {
          const asked = byId.get(b.id);
          if (!asked) return { blockId: b.id, status: "done" as const, actualMin: b.estimateMin };
          return {
            blockId: b.id,
            status: asked.status,
            actualMin: asked.status === "skipped" ? null : (asked.actualMin ?? b.estimateMin),
          };
        });

      const res = await submitDebrief(planId.data, entries);
      revalidatePath("/today");
      revalidatePath("/review");
      const note =
        `Day closed. ${res.loggedMin}m logged of ${res.plannedMin}m planned, ` +
        `${res.carriedOver} carried over. ${res.summary}`;
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
