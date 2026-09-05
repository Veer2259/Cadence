"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { istEndOfDayToUtc } from "@/lib/time";
import {
  taskInput,
  taskPatch,
  taskStatusChange,
  flattenIssues,
} from "@/lib/schemas";
import { z } from "zod";
import { captureFromText } from "@/lib/ai/modes/capture";
import {
  StructuredOutputError,
  DailyQuotaError,
  dailyQuotaResetHint,
} from "@/lib/ai/provider";
import { insertTask } from "@/lib/tasks";
import type { CapturedTask } from "@/lib/ai/schemas";

export type FormResult = { ok: boolean; errors: string[] };

const OK: FormResult = { ok: true, errors: [] };
function fail(errors: string[]): FormResult {
  return { ok: false, errors };
}

/** FormData -> plain object, dropping empty strings so `.nullish()` works. */
function toObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

export async function createTask(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireAuth();

  const raw = toObject(formData);
  const parsed = taskInput.safeParse(raw);
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  const holdForReview = formData.get("hold") === "on";
  const t = parsed.data;

  await db.insert(tasks).values({
    title: t.title,
    notes: t.notes,
    bucketId: t.bucketId,
    category: t.category,
    estimateMin: t.estimateMin,
    dueAt: t.dueDate ? istEndOfDayToUtc(t.dueDate) : null,
    status: holdForReview ? "inbox" : "active",
    source: "manual",
  });

  revalidatePath("/inbox");
  return OK;
}

export async function patchTask(formData: FormData): Promise<FormResult> {
  await requireAuth();

  const parsed = taskPatch.safeParse(toObject(formData));
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  const { id, dueDate, ...rest } = parsed.data;

  const patch: Partial<typeof tasks.$inferInsert> = { ...rest };
  if ("dueDate" in parsed.data) {
    patch.dueAt = dueDate ? istEndOfDayToUtc(dueDate) : null;
  }
  if (Object.keys(patch).length === 0) return OK;

  await db.update(tasks).set(patch).where(eq(tasks.id, id));
  revalidatePath("/inbox");
  return OK;
}

export async function setTaskStatus(formData: FormData): Promise<void> {
  await requireAuth();

  const parsed = taskStatusChange.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Bad status change");

  const { id, status } = parsed.data;
  await db
    .update(tasks)
    .set({
      status,
      completedAt: status === "done" ? new Date() : null,
    })
    .where(eq(tasks.id, id));

  revalidatePath("/inbox");
}

export async function deleteTask(formData: FormData): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(formData.get("id"));
  await db.delete(tasks).where(eq(tasks.id, id));
  revalidatePath("/inbox");
}

/* ------------------------------------------------------------------ */
/*  Capture — brain dump -> parsed tasks (SPEC 6.2). No DB write here. */
/* ------------------------------------------------------------------ */

export type CaptureResponse =
  | { ok: true; tasks: CapturedTask[]; clarifications: string[] }
  | { ok: false; error: string };

export async function captureBrainDump(
  text: string,
  answers?: string,
): Promise<CaptureResponse> {
  await requireAuth();
  const trimmed = (text ?? "").trim();
  if (trimmed.length < 3) return { ok: false, error: "Type a bit more first." };
  if (trimmed.length > 5000) return { ok: false, error: "That's a lot — trim it under 5000 characters." };

  try {
    const result = await captureFromText(trimmed, answers?.trim() || undefined);
    return { ok: true, tasks: result.tasks, clarifications: result.clarifications };
  } catch (e) {
    if (e instanceof DailyQuotaError) {
      return { ok: false, error: `Daily request limit for ${e.model} is used up — ${dailyQuotaResetHint()}.` };
    }
    if (e instanceof StructuredOutputError) return { ok: false, error: e.message };
    const status = (e as { status?: number } | undefined)?.status;
    if (status === 429) return { ok: false, error: "Rate-limited — wait a minute and try again." };
    if (status === 503 || status === 500) return { ok: false, error: "The parser is busy — try again shortly." };
    console.error("[capture]", e);
    return { ok: false, error: "Could not read that brain dump." };
  }
}

const confirmSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        notes: z.string().nullable().optional(),
        bucketName: z.string().nullable().optional(),
        category: z.enum(["deep", "shallow", "calls", "admin", "errand", "personal"]),
        estimateMin: z.coerce.number().int().min(1).max(1440).nullable().optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function confirmCapturedTasks(input: unknown): Promise<FormResult> {
  await requireAuth();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  for (const t of parsed.data.tasks) {
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
  return OK;
}

/**
 * Toggle the must-do-today flag. One tap from the inbox list — this is a hard
 * planning constraint, so it should never be buried behind an edit form.
 */
export async function toggleMustDoToday(formData: FormData): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(formData.get("id"));
  const next = formData.get("mustDoToday") === "true";
  await db.update(tasks).set({ mustDoToday: next }).where(eq(tasks.id, id));
  revalidatePath("/inbox");
  revalidatePath("/today");
}
