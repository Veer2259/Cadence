"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { buckets, weeklyTargets } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { insertTask } from "@/lib/tasks";
import { weekStartOf } from "@/lib/goals";
import { breakdownTurn, loadTranscript } from "@/lib/ai/modes/breakdown";
import { proposeTasks } from "@/lib/ai/modes/kickoff";
import { istToday } from "@/lib/time";
import {
  StructuredOutputError,
  ModelBudgetError,
  DailyQuotaError,
  dailyQuotaResetHint,
} from "@/lib/ai/provider";
import type { BreakdownTurn, KickoffResult } from "@/lib/ai/schemas";

function friendly(e: unknown): string {
  if (e instanceof DailyQuotaError) {
    return `The daily request limit for ${e.model} is used up — ${dailyQuotaResetHint()}.`;
  }
  if (e instanceof ModelBudgetError) {
    return `Gave up after ${e.spent} model calls. Try again in a moment.`;
  }
  if (e instanceof StructuredOutputError) return e.message;
  const status = (e as { status?: number } | undefined)?.status;
  if (status === 429) return "Rate-limited — try again in a minute.";
  if (status === 503 || status === 500) return "The model is busy — try again shortly.";
  console.error("[goals]", e);
  return e instanceof Error ? e.message : "That failed.";
}

/* ------------------------------------------------------------------ */
/*  Breakdown — the dialogue                                          */
/* ------------------------------------------------------------------ */

export type BreakdownReply =
  | { ok: true; turn: BreakdownTurn }
  | { ok: false; error: string };

export async function sendBreakdown(
  bucketId: string,
  userText: string,
): Promise<BreakdownReply> {
  await requireAuth();
  const id = z.string().uuid().safeParse(bucketId);
  if (!id.success) return { ok: false, error: "Unknown bucket." };
  const text = (userText ?? "").trim();
  if (!text) return { ok: false, error: "Say something first." };
  if (text.length > 4000) return { ok: false, error: "That message is too long." };

  try {
    const { turn } = await breakdownTurn({ bucketId: id.data, userText: text });
    revalidatePath("/goals");
    return { ok: true, turn };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function clearBreakdown(bucketId: string): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(bucketId);
  await db.update(buckets).set({ breakdownTranscript: null }).where(eq(buckets.id, id));
  revalidatePath("/goals");
}

/**
 * Accept a breakdown proposal AS EDITED by the person. The payload comes from
 * the review list, not from the model — the model's output is only ever a
 * starting point that the person has already had a chance to change.
 */
const acceptSchema = z.object({
  bucketId: z.string().uuid(),
  outcome: z.string().trim().min(1).max(300),
  outcomeTargetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  weeklyTargets: z
    .array(
      z.object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().trim().min(1).max(300),
        targetHours: z.number().min(0).max(168).nullable(),
      }),
    )
    .max(60),
});

export type AcceptResult = {
  ok: boolean;
  error?: string;
  created?: number;
  /**
   * Task candidates proposed immediately after the outcome was saved.
   *
   * The failure being fixed is that producing targets and producing tasks
   * looked like one step and were two: the person set an outcome, saw targets
   * saved, and never reached the separate screen that turns them into work.
   */
  followOn?: {
    mode: "targets" | "direct";
    note: string | null;
    candidates: KickoffResult["candidates"];
  };
  /** why the handoff produced nothing, when it produced nothing */
  followOnError?: string;
};

export async function acceptBreakdown(input: unknown): Promise<AcceptResult> {
  await requireAuth();
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read that proposal." };
  const { bucketId, outcome, outcomeTargetDate, weeklyTargets: rows } = parsed.data;

  await db
    .update(buckets)
    .set({ outcome, outcomeTargetDate, status: "active" })
    .where(eq(buckets.id, bucketId));

  if (rows.length) {
    await db.insert(weeklyTargets).values(
      rows.map((r) => ({
        bucketId,
        weekStart: r.weekStart,
        description: r.description,
        targetHours: r.targetHours == null ? null : String(r.targetHours),
      })),
    );
  }

  revalidatePath("/goals");
  revalidatePath("/settings");
  revalidatePath("/week");

  // THE HANDOFF. Targets alone are not the deliverable — tasks are. Propose
  // them now, in the same round trip, rather than leaving the person to find a
  // second screen. Still nothing is written: these go to a review list.
  //
  // A failure here must not fail the accept: the outcome and targets ARE saved
  // at this point, and telling the person otherwise would be a lie.
  let followOn: AcceptResult["followOn"];
  let followOnError: string | undefined;
  try {
    const out = await proposeTasks({ bucketId });
    followOn = {
      mode: out.mode,
      note: out.result.note,
      candidates: out.result.candidates,
    };
  } catch (e) {
    followOnError = friendly(e);
  }

  return { ok: true, created: rows.length, followOn, followOnError };
}

/* ------------------------------------------------------------------ */
/*  Weekly kickoff — candidate tasks                                  */
/* ------------------------------------------------------------------ */

export type KickoffReply =
  | { ok: true; result: KickoffResult; mode: "targets" | "direct" }
  | { ok: false; error: string };

export async function runKickoff(
  weekStart?: string,
  bucketId?: string | null,
): Promise<KickoffReply> {
  await requireAuth();
  const wk =
    typeof weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
      ? weekStart
      : weekStartOf(istToday());
  const id = bucketId && z.string().uuid().safeParse(bucketId).success ? bucketId : null;
  try {
    const out = await proposeTasks({ weekStart: wk, bucketId: id });
    return { ok: true, result: out.result, mode: out.mode };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/** Write the candidates the person kept, as edited. Nothing else is written. */
const confirmSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        /** null when the goal had no weekly-target layer. The link stays optional. */
        weeklyTargetId: z.string().uuid().nullable(),
        /** where to file a task that has no target — the goal's own bucket */
        bucketId: z.string().uuid().nullable().optional(),
        category: z.enum(["deep", "shallow", "calls", "admin", "errand", "personal"]),
        estimateMin: z.number().int().min(5).max(1440),
      }),
    )
    .max(50),
});

export async function confirmKickoff(input: unknown): Promise<AcceptResult> {
  await requireAuth();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read those tasks." };

  // Resolve each target's bucket so a linked task lands in the right one. A
  // task with no target carries its own bucketId instead.
  const ids = [
    ...new Set(
      parsed.data.tasks
        .map((t) => t.weeklyTargetId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const rows = ids.length
    ? await db.select().from(weeklyTargets).where(inArray(weeklyTargets.id, ids))
    : [];
  const bucketByTarget = new Map(rows.map((r) => [r.id, r.bucketId]));

  for (const t of parsed.data.tasks) {
    await insertTask({
      title: t.title,
      bucketId: t.weeklyTargetId
        ? (bucketByTarget.get(t.weeklyTargetId) ?? null)
        : (t.bucketId ?? null),
      category: t.category,
      estimateMin: t.estimateMin,
      weeklyTargetId: t.weeklyTargetId,
      status: "active",
      source: "manual",
    });
  }

  revalidatePath("/goals");
  revalidatePath("/inbox");
  return { ok: true, created: parsed.data.tasks.length };
}

export { loadTranscript };
