"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buckets, dayProfile, habits, milestones } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { validateWeeklyWindows, WEEKDAY_KEYS, type WeeklyWindows } from "@/lib/time";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { loadEnergySamples } from "@/lib/energy-db";
import { suggestSharpWindows, MIN_DAYS } from "@/lib/energy";
import {
  bucketInput,
  habitInput,
  dayProfileInput,
  milestoneInput,
  bucketTargetInput,
  flattenIssues,
} from "@/lib/schemas";
import { setBucketTarget } from "@/lib/bucket-targets";

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
  const sharpHours = parseJson(formData, "sharpHours");
  const protectedBlocks = parseJson(formData, "protectedBlocks");
  if ([workWindows, sharpHours, protectedBlocks].some((v) => typeof v === "symbol")) {
    return fail(["The form could not be read — please reload and try again."]);
  }

  const parsed = dayProfileInput.safeParse({
    workWindows,
    sharpHours,
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
    ...validateWeeklyWindows(parsed.data.sharpHours as WeeklyWindows).map(
      (m) => `sharp hours — ${m}`,
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
/*  Sharp hours, tuned from the energy log                            */
/* ------------------------------------------------------------------ */

/**
 * Apply the energy log's suggested sharp hours to every weekday that already
 * has a working window. Never runs on its own — the Settings panel shows the
 * suggestion and this only fires when the person presses Apply.
 */
export async function applySuggestedSharpHours(): Promise<FormResult> {
  await requireAuth();

  const samples = await loadEnergySamples(30);
  const suggestion = suggestSharpWindows(samples);
  if (!suggestion.confident) {
    return fail([
      `Not enough history yet — ${suggestion.dayN} day(s) logged, ${MIN_DAYS} needed.`,
    ]);
  }

  const profile = await getOrCreateDayProfile();
  const next: WeeklyWindows = {};
  for (const day of WEEKDAY_KEYS) {
    const worksToday = (profile.workWindows[day] ?? []).length > 0;
    // Days you never work keep whatever they had; there is no evidence for them.
    next[day] = worksToday ? suggestion.windows.map((w) => [...w] as [string, string]) : (profile.sharpHours[day] ?? []);
  }

  const problems = validateWeeklyWindows(next);
  if (problems.length) return fail(problems.map((m) => `sharp hours — ${m}`));

  await db.update(dayProfile).set({ sharpHours: next }).where(eq(dayProfile.id, 1));

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/review");
  return OK;
}

/* ------------------------------------------------------------------ */
/*  Milestones + weekly bucket targets (the minimal planning layer)   */
/* ------------------------------------------------------------------ */

export async function createMilestone(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireAuth();
  const parsed = milestoneInput.safeParse(toObject(formData));
  if (!parsed.success) return fail(flattenIssues(parsed.error));
  await db.insert(milestones).values(parsed.data);
  revalidatePath("/settings");
  revalidatePath("/review");
  revalidatePath("/inbox");
  return OK;
}

export async function updateMilestone(formData: FormData): Promise<FormResult> {
  await requireAuth();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return fail(["Unknown milestone."]);
  const parsed = milestoneInput.partial().safeParse(toObject(formData));
  if (!parsed.success) return fail(flattenIssues(parsed.error));

  // "done" is a single flag, not a percent — progress itself is derived
  const completed = formData.get("completed");
  const patch: Record<string, unknown> = { ...parsed.data };
  if (completed !== null) patch.completedAt = completed === "true" ? new Date() : null;
  if (formData.get("archived") !== null) {
    patch.archived = formData.get("archived") === "true";
  }

  await db.update(milestones).set(patch).where(eq(milestones.id, id.data));
  revalidatePath("/settings");
  revalidatePath("/review");
  return OK;
}

export async function deleteMilestone(formData: FormData): Promise<void> {
  await requireAuth();
  const id = z.string().uuid().parse(formData.get("id"));
  await db.delete(milestones).where(eq(milestones.id, id));
  revalidatePath("/settings");
  revalidatePath("/review");
}

/**
 * Set or clear a bucket's weekly target (hours in, minutes stored).
 * Void so it can be a plain <form action>; the input is HTML-constrained, and a
 * value that still fails validation throws rather than being swallowed.
 */
export async function saveBucketTarget(formData: FormData): Promise<void> {
  await requireAuth();
  const rawHours = formData.get("targetHours");
  const parsed = bucketTargetInput.safeParse({
    bucketId: formData.get("bucketId"),
    targetHours: rawHours === "" || rawHours === null ? null : rawHours,
  });
  if (!parsed.success) throw new Error(flattenIssues(parsed.error).join("; "));
  await setBucketTarget(parsed.data.bucketId, parsed.data.targetHours);
  revalidatePath("/settings");
  revalidatePath("/week");
}
