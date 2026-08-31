/**
 * db/schema.ts — the single source of truth for the database shape.
 *
 * Everything in section 3 of SPEC.md lives here. Rules that hold everywhere:
 *   - every timestamp is `timestamptz`, stored in UTC
 *   - every duration is an integer number of minutes
 *   - every id is a uuid with a `gen_random_uuid()` default
 */

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*  Enums                                                                      */
/* -------------------------------------------------------------------------- */

/** Work type. Shared by tasks, blocks and the time log. */
export const categoryEnum = pgEnum("category", [
  "deep",
  "shallow",
  "calls",
  "admin",
  "errand",
  "personal",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["low", "normal", "high"]);

export const taskStatusEnum = pgEnum("task_status", [
  "inbox",
  "active",
  "done",
  "dropped",
]);

export const taskSourceEnum = pgEnum("task_source", [
  "dump",
  "manual",
  "voice",
  "carryover",
]);

export const commitmentSourceEnum = pgEnum("commitment_source", ["manual", "gcal"]);

export const planStatusEnum = pgEnum("plan_status", [
  "draft",
  "committed",
  "superseded",
]);

export const blockKindEnum = pgEnum("block_kind", ["task", "fixed", "habit", "break"]);

export const blockStatusEnum = pgEnum("block_status", [
  "planned",
  "done",
  "partial",
  "skipped",
]);

export const overflowActionEnum = pgEnum("overflow_action", [
  "defer",
  "shrink",
  "delegate",
  "drop",
]);

export const calibrationScopeEnum = pgEnum("calibration_scope", ["category", "bucket"]);

/* -------------------------------------------------------------------------- */
/*  buckets — projects / life areas the user defines and retires freely       */
/* -------------------------------------------------------------------------- */

export const buckets = pgTable("buckets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(), // hex
  active: boolean("active").notNull().default(true),
  priorityHint: text("priority_hint"), // free text passed to the planner
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*  tasks                                                                      */
/* -------------------------------------------------------------------------- */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    bucketId: uuid("bucket_id").references(() => buckets.id, { onDelete: "set null" }),
    category: categoryEnum("category").notNull(),
    /** the user's or the model's raw estimate, uncalibrated */
    estimateMin: integer("estimate_min"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    /** `inbox` = captured, not yet confirmed. Only `active` tasks are planned. */
    status: taskStatusEnum("status").notNull().default("inbox"),
    /** self-reference for subtasks, one level only (enforced in app code) */
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    /** incremented whenever a task is carried past its planned day */
    deferCount: integer("defer_count").notNull().default(0),
    source: taskSourceEnum("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // helps the inbox / planner queries that filter by state and deadline
    index("tasks_status_idx").on(t.status),
    index("tasks_due_at_idx").on(t.dueAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  commitments — things that cannot move (meetings, classes, appointments)    */
/* -------------------------------------------------------------------------- */

export const commitments = pgTable("commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  /** RRULE string. Support is deliberately minimal: daily / weekly-by-day. */
  recurrence: text("recurrence"),
  source: commitmentSourceEnum("source").notNull().default("manual"),
  gcalEventId: text("gcal_event_id"),
});

/* -------------------------------------------------------------------------- */
/*  habits — recurring things the user wants placed but that aren't tasks      */
/* -------------------------------------------------------------------------- */

export const habits = pgTable("habits", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cadence: text("cadence").notNull(), // e.g. "3x/week", "daily", "mon,wed,fri"
  durationMin: integer("duration_min").notNull(),
  preferredWindow: text("preferred_window"), // e.g. "06:00-08:00" or "evening"
  bucketId: uuid("bucket_id").references(() => buckets.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
});

/* -------------------------------------------------------------------------- */
/*  plans                                                                      */
/* -------------------------------------------------------------------------- */

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(), // IST calendar date, stored as YYYY-MM-DD
    status: planStatusEnum("status").notNull().default("draft"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    model: text("model"), // which model produced it
    /** the exact payload sent to the model — needed when a plan comes out wrong */
    inputSnapshot: jsonb("input_snapshot"),
    /** the model's validated result (blocks, overflow, calibrationNote) as returned */
    outputSnapshot: jsonb("output_snapshot"),
    /** set when this plan came from a rebalance */
    parentPlanId: uuid("parent_plan_id").references((): AnyPgColumn => plans.id),
  },
  (t) => [
    // "Only one plan per date may be draft or committed at a time."
    uniqueIndex("plans_one_live_per_date")
      .on(t.date)
      .where(sql`${t.status} in ('draft', 'committed')`),
  ],
);

/* -------------------------------------------------------------------------- */
/*  blocks — one scheduled slot on a plan                                      */
/* -------------------------------------------------------------------------- */

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    habitId: uuid("habit_id").references(() => habits.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    kind: blockKindEnum("kind").notNull(),
    /** denormalised so a plan renders without joins */
    title: text("title").notNull(),
    category: categoryEnum("category").notNull(),
    /** required for every block. One line, <= 90 chars (enforced in app code). */
    reason: text("reason").notNull(),
    /** calibrated estimate used when scheduling */
    estimateMin: integer("estimate_min").notNull(),
    /** pre-calibration, for the review screen */
    rawEstimateMin: integer("raw_estimate_min").notNull(),
    status: blockStatusEnum("status").notNull().default("planned"),
    actualMin: integer("actual_min"), // filled at debrief
  },
  (t) => [index("blocks_plan_id_idx").on(t.planId)],
);

/* -------------------------------------------------------------------------- */
/*  overflow — work that did not fit, with an honest reason and next action    */
/* -------------------------------------------------------------------------- */

export const overflow = pgTable("overflow", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  action: overflowActionEnum("action").notNull(),
  suggestion: text("suggestion").notNull(),
});

/* -------------------------------------------------------------------------- */
/*  time_log — what actually happened                                          */
/* -------------------------------------------------------------------------- */

export const timeLog = pgTable("time_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull(),
  bucketId: uuid("bucket_id").references(() => buckets.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  category: categoryEnum("category").notNull(),
  /** false for unplanned work logged after the fact */
  planned: boolean("planned").notNull().default(true),
  note: text("note"),
});

/* -------------------------------------------------------------------------- */
/*  calibration — accumulated actual/estimate ratios, the compounding feature  */
/* -------------------------------------------------------------------------- */

export const calibration = pgTable(
  "calibration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: calibrationScopeEnum("scope").notNull(),
    key: text("key").notNull(), // the category name or the bucket id
    /** actual / estimate, exponentially weighted */
    ratio: numeric("ratio", { precision: 4, scale: 2 }).notNull().default("1.00"),
    sampleN: integer("sample_n").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calibration_scope_key_uq").on(t.scope, t.key)],
);

/* -------------------------------------------------------------------------- */
/*  day_profile — singleton row describing how the user's days are shaped      */
/* -------------------------------------------------------------------------- */

export const dayProfile = pgTable(
  "day_profile",
  {
    id: integer("id").primaryKey(), // always 1
    /** per weekday: { mon: [["09:00","19:00"]], ... } — array allows split days */
    workWindows: jsonb("work_windows").notNull(),
    /** per weekday, same shape; when the user thinks clearly */
    sharpHours: jsonb("sharp_hours").notNull(),
    /** hard ceiling on scheduled work, classes included */
    dailyCapMin: integer("daily_cap_min").notNull(),
    /** recurring non-negotiables: meals, family, sleep */
    protectedBlocks: jsonb("protected_blocks").notNull(),
    minBlockMin: integer("min_block_min").notNull().default(30),
    maxBlockMin: integer("max_block_min").notNull().default(150),
    /** inserted between consecutive deep blocks */
    breakMin: integer("break_min").notNull().default(15),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
  },
  (t) => [check("day_profile_singleton", sql`${t.id} = 1`)],
);

/* -------------------------------------------------------------------------- */
/*  chat_messages — history for the assistant rail (keep the last 200)         */
/* -------------------------------------------------------------------------- */

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role").notNull(), // "user" | "assistant" | "tool"
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*  Inferred types — import these instead of hand-writing row shapes           */
/* -------------------------------------------------------------------------- */

export type Bucket = typeof buckets.$inferSelect;
export type NewBucket = typeof buckets.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Commitment = typeof commitments.$inferSelect;
export type NewCommitment = typeof commitments.$inferInsert;
export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
export type OverflowRow = typeof overflow.$inferSelect;
export type NewOverflowRow = typeof overflow.$inferInsert;
export type TimeLogRow = typeof timeLog.$inferSelect;
export type NewTimeLogRow = typeof timeLog.$inferInsert;
export type CalibrationRow = typeof calibration.$inferSelect;
export type NewCalibrationRow = typeof calibration.$inferInsert;
export type DayProfile = typeof dayProfile.$inferSelect;
export type NewDayProfile = typeof dayProfile.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
