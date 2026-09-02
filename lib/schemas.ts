/**
 * lib/schemas.ts — Zod schemas for every form / Server Action input (SPEC section 2).
 * Nothing reaches the database without passing through one of these.
 */

import { z } from "zod";

export const CATEGORIES = [
  "deep",
  "shallow",
  "calls",
  "admin",
  "errand",
  "personal",
] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;
export const TASK_STATUSES = ["inbox", "active", "done", "dropped"] as const;

export const zCategory = z.enum(CATEGORIES);
export const zPriority = z.enum(PRIORITIES);

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #2F5D50");

const hm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/* ------------------------------------------------------------------ */
/*  Buckets                                                           */
/* ------------------------------------------------------------------ */

export const bucketInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(40)
    .regex(/^[a-z0-9][a-z0-9 _-]*$/, "Lowercase letters, numbers, spaces, - and _"),
  color: hex,
  priorityHint: z.string().trim().max(120).nullish().transform((v) => v || null),
  active: z.boolean().default(true),
});
export type BucketInput = z.infer<typeof bucketInput>;

/* ------------------------------------------------------------------ */
/*  Tasks                                                             */
/* ------------------------------------------------------------------ */

const optionalUuid = z
  .string()
  .uuid()
  .nullish()
  .transform((v) => v || null);

export const taskInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
  bucketId: optionalUuid,
  category: zCategory,
  estimateMin: z.coerce
    .number()
    .int()
    .min(5)
    .max(1440)
    .nullish()
    .transform((v) => v ?? null),
  dueDate: ymd.nullish().transform((v) => v || null),
  priority: zPriority.default("normal"),
  weeklyTargetId: optionalUuid,
});
export type TaskInput = z.infer<typeof taskInput>;

export const taskPatch = taskInput.partial().extend({
  id: z.string().uuid(),
});
export type TaskPatch = z.infer<typeof taskPatch>;

export const taskStatusChange = z.object({
  id: z.string().uuid(),
  status: z.enum(TASK_STATUSES),
});

/* ------------------------------------------------------------------ */
/*  Habits                                                            */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Structured habit cadence — mirrors HabitCadence in lib/habits.ts. */
export const habitCadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({
    kind: z.literal("days"),
    days: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day"),
  }),
  z.object({
    kind: z.literal("per_week"),
    count: z.coerce.number().int().min(1).max(7),
  }),
]);

export const habitInput = z.object({
  name: z.string().trim().min(1).max(80),
  cadence: habitCadenceSchema,
  durationMin: z.coerce.number().int().min(5).max(480),
  preferredWindow: z.string().trim().max(40).nullish().transform((v) => v || null),
  bucketId: optionalUuid,
  active: z.boolean().default(true),
});
export type HabitInput = z.infer<typeof habitInput>;

/* ------------------------------------------------------------------ */
/*  Commitments — one-off fixed things (meetings, a match, an appt)    */
/* ------------------------------------------------------------------ */

export const commitmentInput = z
  .object({
    title: z.string().trim().min(1, "Give it a name").max(120),
    date: ymd,
    start: hm,
    end: hm,
  })
  // zero-padded 24h HH:mm sorts lexically the same as numerically
  .refine((v) => v.end > v.start, {
    message: "End must be after start",
    path: ["end"],
  });
export type CommitmentInput = z.infer<typeof commitmentInput>;

/* ------------------------------------------------------------------ */
/*  The goal layer                                                    */
/* ------------------------------------------------------------------ */

export const bucketGoalInput = z.object({
  bucketId: z.string().uuid(),
  outcome: z.string().trim().max(300).nullish().transform((v) => v || null),
  outcomeTargetDate: ymd.nullish().transform((v) => v || null),
  status: z.enum(["active", "achieved", "abandoned"]).default("active"),
});

export const weeklyTargetInput = z.object({
  bucketId: z.string().uuid(),
  weekStart: ymd,
  description: z.string().trim().min(1, "Say what the target is").max(300),
  targetHours: z.coerce
    .number()
    .min(0)
    .max(168)
    .nullish()
    .transform((v) => (v == null || Number.isNaN(v) ? null : v)),
});
export type WeeklyTargetInput = z.infer<typeof weeklyTargetInput>;

/** Weekly target hours for a bucket. Empty clears it. */
export const bucketTargetInput = z.object({
  bucketId: z.string().uuid(),
  targetHours: z.coerce.number().min(0).max(168).nullish().transform((v) => (v == null ? null : Math.round(v * 60))),
});

/* ------------------------------------------------------------------ */
/*  Day profile                                                       */
/* ------------------------------------------------------------------ */

const windowTuple = z.tuple([hm, hm]);
const weeklyWindows = z.object({
  mon: z.array(windowTuple).default([]),
  tue: z.array(windowTuple).default([]),
  wed: z.array(windowTuple).default([]),
  thu: z.array(windowTuple).default([]),
  fri: z.array(windowTuple).default([]),
  sat: z.array(windowTuple).default([]),
  sun: z.array(windowTuple).default([]),
});

const protectedBlock = z.object({
  label: z.string().trim().min(1).max(40),
  start: hm,
  end: hm,
});

export const dayProfileInput = z
  .object({
    workWindows: weeklyWindows,
    dailyCapMin: z.coerce.number().int().min(30).max(1440),
    protectedBlocks: z.array(protectedBlock).max(20),
    minBlockMin: z.coerce.number().int().min(5).max(240),
    maxBlockMin: z.coerce.number().int().min(15).max(600),
    breakMin: z.coerce.number().int().min(0).max(120),
  })
  .refine((v) => v.maxBlockMin >= v.minBlockMin, {
    message: "Max block length must be at least the min block length",
    path: ["maxBlockMin"],
  });
export type DayProfileInput = z.infer<typeof dayProfileInput>;

/** Small helper: flatten a ZodError into "field: message" strings for the UI. */
export function flattenIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.join(".");
    return path ? `${path}: ${i.message}` : i.message;
  });
}
