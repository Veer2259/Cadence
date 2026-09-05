/**
 * lib/schemas.ts — Zod schemas for every form / Server Action input (SPEC section 2).
 * Nothing reaches the database without passing through one of these.
 */

import { z } from "zod";

export const CATEGORIES = ["deep", "shallow", "admin"] as const;
export const TASK_STATUSES = ["inbox", "active", "done", "dropped"] as const;

export const zCategory = z.enum(CATEGORIES);

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

/* -------------------------------------------------------------------------- */
/*  Timetable import                                                          */
/* -------------------------------------------------------------------------- */

export const EXAM_KINDS = ["mid_block", "end_block", "other"] as const;

/**
 * One parsed session from a timetable PDF.
 *
 * `date` is nullable ON PURPOSE. A session the model could not date is a PARSE
 * FAILURE, not something to fill in from the current week or a day-of-week
 * guess — a class placed on the wrong date corrupts every plan built on top of
 * it. Null here blocks confirmation for that row; nothing downstream is allowed
 * to invent one.
 */
export const timetableSession = z.object({
  /** IST calendar date READ FROM THE PDF, or null when it could not be read */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** IST clock times, HH:mm */
  start: hm.nullable(),
  end: hm.nullable(),
  title: z.string().min(1).max(200),
  /** subject code as printed, when there is one */
  subjectCode: z.string().max(40).nullable(),
  location: z.string().max(200).nullable(),
  /** true when the instruction says this one is not taken */
  excluded: z.boolean(),
  /** why it was excluded, or why it was kept when that was a judgement call */
  reason: z.string().max(300).nullable(),
  /** the model was unsure — surfaced for review rather than quietly accepted */
  uncertain: z.boolean().default(false),
});
export type TimetableSession = z.infer<typeof timetableSession>;

export const timetableExam = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  start: hm.nullable(),
  end: hm.nullable(),
  subjectCode: z.string().max(40),
  subjectName: z.string().max(200).nullable(),
  kind: z.enum(EXAM_KINDS),
  location: z.string().max(200).nullable(),
  title: z.string().max(200),
  uncertain: z.boolean().default(false),
});
export type TimetableExam = z.infer<typeof timetableExam>;

export const timetableParse = z.object({
  sessions: z.array(timetableSession).max(400),
  exams: z.array(timetableExam).max(50),
  /** anything the model wants the person to check before confirming */
  warnings: z.array(z.string().max(300)).max(30),
  /** what the sheet says the term/block is, verbatim */
  termLabel: z.string().max(200).nullable(),
});
export type TimetableParse = z.infer<typeof timetableParse>;

/** Small helper: flatten a ZodError into "field: message" strings for the UI. */
export function flattenIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.join(".");
    return path ? `${path}: ${i.message}` : i.message;
  });
}
