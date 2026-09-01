"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { buckets, weeklyTargets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { istToday } from "@/lib/time";
import { insertTask } from "@/lib/tasks";
import { weekStartOf } from "@/lib/goals";
import { breakdownTurn, loadTranscript } from "@/lib/ai/modes/breakdown";
import { proposeWeek } from "@/lib/ai/modes/kickoff";
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

export type AcceptResult = { ok: boolean; error?: string; created?: number };

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
  return { ok: true, created: rows.length };
}

/* ------------------------------------------------------------------ */
/*  Weekly kickoff — candidate tasks                                  */
/* ------------------------------------------------------------------ */

export type KickoffReply =
  | { ok: true; result: KickoffResult }
  | { ok: false; error: string };

export async function runKickoff(weekStart?: string): Promise<KickoffReply> {
  await requireAuth();
  const wk =
    typeof weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
      ? weekStart
      : weekStartOf(istToday());
  try {
    const { result } = await proposeWeek(wk);
    return { ok: true, result };
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
        weeklyTargetId: z.string().uuid(),
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

  // resolve each target's bucket so the task lands in the right one
  const ids = [...new Set(parsed.data.tasks.map((t) => t.weeklyTargetId))];
  const targets = ids.length
    ? await db.select().from(weeklyTargets).where(eq(weeklyTargets.id, ids[0]))
    : [];
  const bucketByTarget = new Map<string, string>();
  for (const id of ids) {
    const row =
      targets.find((t) => t.id === id) ??
      (await db.query.weeklyTargets.findFirst({ where: eq(weeklyTargets.id, id) }));
    if (row) bucketByTarget.set(id, row.bucketId);
  }

  for (const t of parsed.data.tasks) {
    await insertTask({
      title: t.title,
      bucketId: bucketByTarget.get(t.weeklyTargetId) ?? null,
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
