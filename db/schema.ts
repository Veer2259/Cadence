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

/** How sharp the user felt. Ordered worst -> best so the ordinal is meaningful. */
export const energyLevelEnum = pgEnum("energy_level", ["fried", "ok", "sharp"]);

/** Where a bucket's outcome stands. Set by hand; nothing infers it. */
export const bucketStatusEnum = pgEnum("bucket_status", [
  "active",
  "achieved",
  "abandoned",
]);

/** Where one week's target ended up. `planned` until the week is reviewed. */
export const weeklyTargetStatusEnum = pgEnum("weekly_target_status", [
  "planned",
  "hit",
  "missed",
  "partial",
  "dropped",
]);

/* -------------------------------------------------------------------------- */
/*  buckets — projects / life areas the user defines and retires freely       */
/* -------------------------------------------------------------------------- */

export const buckets = pgTable("buckets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(), // hex
  active: boolean("active").notNull().default(true),
  priorityHint: text("priority_hint"), // free text passed to the planner
  /**
   * Intended hours per week for this bucket, in minutes. Null = no target.
   * The Week screen compares this against logged time. It is a statement of
   * intent only — nothing schedules against it and nothing enforces it.
   */
  weeklyTargetMin: integer("weekly_target_min"),
  /**
   * The guiding star: what "done" looks like, in one sentence. A bucket with no
   * outcome is just a label, and behaves exactly as it always has.
   */
  outcome: text("outcome"),
  /** when the outcome is meant to be true by */
  outcomeTargetDate: date("outcome_target_date"),
  status: bucketStatusEnum("status").notNull().default("active"),
  /**
   * The breakdown dialogue that produced the outcome and its targets, kept so
   * the reasoning behind them is still readable months later.
   */
  breakdownTranscript: jsonb("breakdown_transcript"),
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
    /**
     * OPTIONAL link to a week's target. A task without one must behave exactly
     * as it always has — if assigning a target were ever a precondition for
     * planning a task, capture would stop happening.
     */
    weeklyTargetId: uuid("weekly_target_id").references(() => weeklyTargets.id, {
      onDelete: "set null",
    }),
    /**
     * A hard constraint, not a priority. A must-do task CANNOT be sent to
     * overflow: compose refuses to build a plan that defers one. Deliberately
     * separate from `priority`, which only ranks.
     */
    mustDoToday: boolean("must_do_today").notNull().default(false),
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
  /** HabitCadence: { kind:"daily" } | { kind:"days", days } | { kind:"per_week", count }.
   *  Read through narrowCadence() in lib/habits.ts. */
  cadence: jsonb("cadence").notNull(),
  durationMin: integer("duration_min").notNull(),
  preferredWindow: text("preferred_window"), // e.g. "06:00-08:00" or "evening"
  bucketId: uuid("bucket_id").references(() => buckets.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
});

/* -------------------------------------------------------------------------- */
/*  weekly_targets — one week's slice of a bucket's outcome                    */
/*                                                                             */
/*  The layer between "what I am trying to achieve" and "what I did today".    */
/*  Deliberately thin: a description, an optional hour target, a status. No    */
/*  dependencies, no nesting, no percent-complete field.                      */
/* -------------------------------------------------------------------------- */

export const weeklyTargets = pgTable(
  "weekly_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucketId: uuid("bucket_id")
      .notNull()
      .references(() => buckets.id, { onDelete: "cascade" }),
    /** IST Monday that starts the week this target belongs to */
    weekStart: date("week_start").notNull(),
    description: text("description").notNull(),
    /** optional — a target can be a deliverable rather than an amount of time */
    targetHours: numeric("target_hours", { precision: 5, scale: 2 }),
    status: weeklyTargetStatusEnum("status").notNull().default("planned"),
    /** one line written at review time about how it actually went */
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("weekly_targets_week_idx").on(t.weekStart)],
);

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
    /** set once the day has been debriefed — blocks calibration double-counting */
    debriefedAt: timestamp("debriefed_at", { withTimezone: true }),
    /** the two-line descriptive summary written at debrief */
    debriefSummary: text("debrief_summary"),
  },
  (t) => [
    // At most one committed plan per date. A rebalance draft is allowed to
    // coexist with its committed parent (SPEC 6.3); saveDraftPlan enforces the
    // "one draft per date" half in code.
    uniqueIndex("plans_one_committed_per_date")
      .on(t.date)
      .where(sql`${t.status} = 'committed'`),
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
    /**
     * When the status was actually set — by the ribbon's log-as-you-go control
     * or at debrief. This is the ONLY evidence of when work really happened:
     * start_at/end_at are the plan's intent and never move. Approximate actual
     * start = logged_at - actual_min.
     */
    loggedAt: timestamp("logged_at", { withTimezone: true }),
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
  /**
   * What the plan intended, kept alongside what happened. start_at is the ACTUAL
   * start where it is known; this is the planned one, so "when do I do deep work
   * versus when I meant to" is answerable from this table alone.
   */
  plannedStartAt: timestamp("planned_start_at", { withTimezone: true }),
  /**
   * The uncalibrated estimate this work was given. Without it the ledger records
   * duration but not accuracy, and estimate-vs-actual cannot be recomputed or
   * sliced later — the calibration table only keeps a rolling average.
   */
  rawEstimateMin: integer("raw_estimate_min"),
  /** prevailing energy nearest this work, denormalised so slicing is a plain query */
  energyLevel: energyLevelEnum("energy_level"),
  /** task / habit / fixed — so habit time can be separated from work time */
  kind: blockKindEnum("kind"),
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
/*  seed_runs — provenance for db/seed.ts, so it can tell its own rows apart   */
/*  from anything the user entered and refuse to clobber real data.           */
/* -------------------------------------------------------------------------- */

export const seedRuns = pgTable("seed_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  /** ids created by this run */
  taskIds: jsonb("task_ids").$type<string[]>().notNull(),
  bucketIds: jsonb("bucket_ids").$type<string[]>().notNull(),
  habitIds: jsonb("habit_ids").$type<string[]>().notNull(),
});

/* -------------------------------------------------------------------------- */
/*  energy_log — timestamped "how sharp am I right now" samples                */
/*                                                                             */
/*  Recorded by hand (a one-tap check-in on Today) and, for free, whenever a    */
/*  rebalance asks for an energy level. Samples carry a minute-of-day so the    */
/*  hour bucketing that tunes sharp_hours is plain integer maths and never      */
/*  depends on the database's own timezone handling.                           */
/* -------------------------------------------------------------------------- */

export const energyLog = pgTable(
  "energy_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** IST calendar date this sample belongs to */
    date: date("date").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** minutes since IST midnight, 0..1439 */
    minuteOfDay: integer("minute_of_day").notNull(),
    level: energyLevelEnum("level").notNull(),
    /** "checkin" (Today) or "rebalance" (answered on the replan form) */
    source: text("source").notNull().default("checkin"),
  },
  (t) => [index("energy_log_date_idx").on(t.date)],
);

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
export type EnergyLogRow = typeof energyLog.$inferSelect;
export type NewEnergyLogRow = typeof energyLog.$inferInsert;
export type WeeklyTarget = typeof weeklyTargets.$inferSelect;
export type NewWeeklyTarget = typeof weeklyTargets.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
