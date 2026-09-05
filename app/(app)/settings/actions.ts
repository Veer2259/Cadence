"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buckets, dayProfile, habits, weeklyTargets } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { validateWeeklyWindows, type WeeklyWindows } from "@/lib/time";
import {
  bucketInput,
  habitInput,
  dayProfileInput,
  bucketGoalInput,
  weeklyTargetInput,
  flattenIssues,
} from "@/lib/schemas";

export type FormResult = { ok: boolean; errors: string[] };
const OK: FormResult = { ok: true, errors: [] };
const fail = (errors: string[]): FormResult => ({ ok: false, errors });

function toObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Day profile                                                       */
/* ------------------------------------------------------------------ */

function parseJson(fd: FormData, key: string): unknown {
  const raw = fd.get(key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return Symbol("bad-json");
  }
}

export async function saveDayProfile(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireAuth();

  const workWindows = parseJson(formData, "workWindows");
  const protectedBlocks = parseJson(formData, "protectedBlocks");
  if ([workWindows, protectedBlocks].some((v) => typeof v === "symbol")) {
    return fail(["The form could not be read — please reload and try again."]);
  }

  const parsed = dayProfileInput.safeParse({
    workWindows,
    protectedBlocks,
    dailyCapMin: formData.get("dailyCapMin"),
    minBlockMin: formData.get("minBlockMin"),
    maxBlockMin: formData.get("maxBlockMin"),
    breakMin: formData.get("breakMin"),
  });
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  const overlap = [
    ...validateWeeklyWindows(parsed.data.workWindows as WeeklyWindows).map(
      (m) => `work windows — ${m}`,
    ),
  ];
  if (overlap.length) return fail(overlap);

  const value = { ...parsed.data, id: 1 as const, timezone: "Asia/Kolkata" };

  await db
    .insert(dayProfile)
    .values(value)
    .onConflictDoUpdate({ target: dayProfile.id, set: value });

  revalidatePath("/settings");
  return OK;
}

/* ------------------------------------------------------------------ */
/*  Buckets                                                           */
/* ------------------------------------------------------------------ */

export async function createBucket(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireAuth();
  const parsed = bucketInput.safeParse({
    ...toObject(formData),
    active: true,
  });
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  try {
    await db.insert(buckets).values(parsed.data);
  } catch {
    return fail([`A bucket named "${parsed.data.name}" already exists.`]);
  }
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return OK;
}

export async function updateBucket(formData: FormData): Promise<FormResult> {
  await requireAuth();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return fail(["Unknown bucket."]);

  const parsed = bucketInput
    .partial()
    .safeParse(toObject(formData));
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  await db.update(buckets).set(parsed.data).where(eq(buckets.id, id.data));
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return OK;
}

export async function setBucketActive(formData: FormData): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(formData.get("id"));
  const active = formData.get("active") === "true";
  await db.update(buckets).set({ active }).where(eq(buckets.id, id));
  revalidatePath("/settings");
  revalidatePath("/inbox");
}

/* ------------------------------------------------------------------ */
/*  Habits                                                            */
/* ------------------------------------------------------------------ */

export async function createHabit(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireAuth();
  const cadence = parseJson(formData, "cadence");
  if (typeof cadence === "symbol") {
    return fail(["The cadence could not be read — please reload and try again."]);
  }
  const parsed = habitInput.safeParse({
    ...toObject(formData),
    cadence,
    active: true,
  });
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  await db.insert(habits).values(parsed.data);
  revalidatePath("/settings");
  return OK;
}

export async function updateHabit(formData: FormData): Promise<FormResult> {
  await requireAuth();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return fail(["Unknown habit."]);

  const cadence = parseJson(formData, "cadence");
  if (typeof cadence === "symbol") {
    return fail(["The cadence could not be read — please reload and try again."]);
  }
  const parsed = habitInput
    .omit({ active: true })
    .partial()
    .safeParse({ ...toObject(formData), cadence });
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  await db
    .update(habits)
    .set({ ...parsed.data, active: formData.get("active") === "true" })
    .where(eq(habits.id, id.data));
  revalidatePath("/settings");
  return OK;
}

export async function deleteHabit(formData: FormData): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(formData.get("id"));
  await db.delete(habits).where(eq(habits.id, id));
  revalidatePath("/settings");
}


/* ------------------------------------------------------------------ */
/*  The goal layer: bucket outcomes + weekly targets                  */
/* ------------------------------------------------------------------ */

/** Set a bucket's outcome, target date and status. All optional. */
export async function saveBucketGoal(formData: FormData): Promise<void> {
  await requireAuth();
  const parsed = bucketGoalInput.safeParse({
    bucketId: formData.get("bucketId"),
    outcome: formData.get("outcome"),
    outcomeTargetDate: formData.get("outcomeTargetDate"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error(flattenIssues(parsed.error).join("; "));
  const { bucketId, ...rest } = parsed.data;
  await db.update(buckets).set(rest).where(eq(buckets.id, bucketId));
  revalidatePath("/settings");
  revalidatePath("/week");
  revalidatePath("/review");
}

export async function createWeeklyTarget(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireAuth();
  const parsed = weeklyTargetInput.safeParse(toObject(formData));
  if (!parsed.success) return fail(flattenIssues(parsed.error));
  await db.insert(weeklyTargets).values({
    ...parsed.data,
    targetHours: parsed.data.targetHours == null ? null : String(parsed.data.targetHours),
  });
  revalidatePath("/settings");
  revalidatePath("/week");
  revalidatePath("/inbox");
  return OK;
}

export async function updateWeeklyTarget(formData: FormData): Promise<FormResult> {
  await requireAuth();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return fail(["Unknown target."]);
  const parsed = weeklyTargetInput.partial().safeParse(toObject(formData));
  if (!parsed.success) return fail(flattenIssues(parsed.error));
  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.targetHours !== undefined) {
    patch.targetHours =
      parsed.data.targetHours == null ? null : String(parsed.data.targetHours);
  }
  const status = formData.get("status");
  if (typeof status === "string" && status) patch.status = status;
  const note = formData.get("reviewNote");
  if (note !== null) patch.reviewNote = String(note) || null;

  await db.update(weeklyTargets).set(patch).where(eq(weeklyTargets.id, id.data));
  revalidatePath("/settings");
  revalidatePath("/week");
  revalidatePath("/review");
  return OK;
}

export async function deleteWeeklyTarget(formData: FormData): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(formData.get("id"));
  await db.delete(weeklyTargets).where(eq(weeklyTargets.id, id));
  revalidatePath("/settings");
  revalidatePath("/week");
}

