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
    priority: t.priority,
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
