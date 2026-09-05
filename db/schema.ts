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
  unique,
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

/**
 * Work type. Shared by tasks, blocks and the time log.
 *
 * Three, not six. `calls`, `errand` and `personal` were choices paid for at
 * task entry — on every task, every day — and they bought almost nothing: they
 * split the calibration history into thinner slices without changing where the
 * planner put anything.
 */
export const categoryEnum = pgEnum("category", ["deep", "shallow", "admin"]);

export const taskStatusEnum = pgEnum("task_status", [
  "inbox",
  "active",
  "done",
  "dropped",
]);

export const taskSourceEnum = pgEnum("task_source", ["dump", "manual", "carryover"]);

export const commitmentSourceEnum = pgEnum("commitment_source", [
  "manual",
  /** created by a timetable PDF import — replaceable, unlike a manual one */
  "timetable",
]);

/** Which assessment an exam is. Taken from the timetable, never inferred. */
export const examKindEnum = pgEnum("exam_kind", ["mid_block", "end_block", "other"]);

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
    /** `inbox` = captured, not yet confirmed. Only `active` tasks are planned. */
    status: taskStatusEnum("status").notNull().default("inbox"),
    /**
     * OPTIONAL link to a week's target. A task without one must behave exactly
     * as it always has — if assigning a target were ever a precondition for
     * planning a task, capture would stop happening.
     */
    weeklyTargetId: uuid("weekly_target_id").references(() => weeklyTargets.id, {
      onDelete: "set null",
    }),
    /**
     * A hard constraint. A must-do task CANNOT be sent to overflow: compose
     * refuses to build a plan that defers one. Importance otherwise lives in
     * due_at, defer_count and the day's bucket emphasis.
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
  /**
   * The timetable import that created this row, when source = "timetable".
   *
   * Re-importing replaces previously imported commitments whose dates overlap
   * the new range. A manually created commitment has no import id and is never
   * touched — that separation is the whole point of storing this.
   */
  timetableImportId: uuid("timetable_import_id").references(
    (): AnyPgColumn => timetableImports.id,
    { onDelete: "set null" },
  ),
});

/**
 * One upload of a timetable PDF.
 *
 * Keeps the date range the import covers, so a later import knows exactly which
 * previously imported rows it supersedes, and the free-text instruction, so the
 * reasoning behind an exclusion is still readable months later — the same
 * argument as buckets.breakdown_transcript.
 */
export const timetableImports = pgTable("timetable_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  fileName: text("file_name"),
  /** the free-text instruction sent to the model with the PDF */
  instruction: text("instruction"),
  /** IST dates the import covers, from the sessions it produced */
  rangeStart: date("range_start").notNull(),
  rangeEnd: date("range_end").notNull(),
  /** sessions written, and sessions excluded — both, so the count is honest */
  sessionCount: integer("session_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
});

/**
 * An exam, read from a timetable.
 *
 * An exam is a DEADLINE with work behind it, which is exactly what the goal
 * layer already models — so each exam links to a bucket whose outcome and
 * outcome_target_date it drives. Nothing here re-implements goals; it points at
 * them. Because an exam is days or weeks away, it falls inside
 * SHORT_HORIZON_WEEKS and the goal pipeline proposes tasks directly rather than
 * inventing weekly targets for a two-week block.
 */
export const exams = pgTable(
  "exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** subject code exactly as printed, e.g. "PWMC" */
    subjectCode: text("subject_code").notNull(),
    /** full subject name when the sheet gives one */
    subjectName: text("subject_name"),
    kind: examKindEnum("kind").notNull().default("other"),
    /** IST calendar date, READ from the timetable — never inferred */
    date: date("date").notNull(),
    /** IST clock times when the sheet states them; often it does not */
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    location: text("location"),
    /** the bucket carrying this exam as its goal */
    bucketId: uuid("bucket_id").references(() => buckets.id, { onDelete: "set null" }),
    timetableImportId: uuid("timetable_import_id").references(
      (): AnyPgColumn => timetableImports.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One exam of a given kind per subject per date. Re-importing the same
    // sheet must not produce a second copy.
    unique("exams_subject_date_kind_uq").on(t.subjectCode, t.date, t.kind),
    index("exams_date_idx").on(t.date),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Inferred types — import these instead of hand-writing row shapes           */
/* -------------------------------------------------------------------------- */

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

/**
 * Category is the only scope.
 *
 * Bucket-scope ratios were computed on every debrief and read by nothing: every
 * consumer — compose, rebalance, capacity, pressure, review — already filtered
 * to the category rows. They were write-only.
 */
export const calibration = pgTable(
  "calibration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(), // the category name
    /** actual / estimate, exponentially weighted */
    ratio: numeric("ratio", { precision: 4, scale: 2 }).notNull().default("1.00"),
    sampleN: integer("sample_n").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calibration_key_uq").on(t.key)],
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
/*  focus_scores — LEARNED focus hours, one row per hour of day                */
/*                                                                             */
/*  Replaces the declared day_profile.sharp_hours. Asking someone to predict   */
/*  when they think clearly is a guess, and that guess contradicted the work   */
/*  windows badly enough to defer real work. Recomputed at debrief from        */
/*  deep-category blocks: how close actual came to estimate, and how often the */
/*  slot was skipped.                                                          */
/* -------------------------------------------------------------------------- */

export const focusScores = pgTable(
  "focus_scores",
  {
    /** 0..23, IST. One row per hour; the hour IS the key. */
    hour: integer("hour").primaryKey(),
    /** 0..1, higher is better. Null until there are enough samples. */
    score: numeric("score", { precision: 4, scale: 2 }),
    /** mean actual/estimate for deep work in this hour */
    meanRatio: numeric("mean_ratio", { precision: 4, scale: 2 }),
    skipRate: numeric("skip_rate", { precision: 4, scale: 2 }).notNull().default("0"),
    sampleN: integer("sample_n").notNull().default(0),
    /**
     * Manual correction, 0..1. Always wins over the learned score — the
     * evidence is shown on Review so a wrong hour can be overridden by hand.
     */
    manualScore: numeric("manual_score", { precision: 4, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("focus_scores_hour_range", sql`${t.hour} >= 0 and ${t.hour} <= 23`)],
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

/**
 * Which buckets matter most on one particular day.
 *
 * "Today, CV matters more than case comp" had nowhere to live: priority ranks
 * TASKS and must_do_today constrains them, but neither says anything about
 * which BUCKET the day should lean towards when two pieces of work compete for
 * the same slot.
 *
 * One row per date, so the date is the key. `bucket_ids` is ORDERED — first is
 * most emphasised — and naming a single bucket is simply a one-element list.
 *
 * This is a PREFERENCE fed into compose, never a constraint. See
 * lib/emphasis.ts and the compose prompt: it may order placement and break
 * ties, and it may never defer a task or send one to overflow while working
 * minutes remain unused.
 */
export const bucketEmphasis = pgTable("bucket_emphasis", {
  /** IST calendar date. One ordering per day, so this is the primary key. */
  date: date("date").primaryKey(),
  /**
   * Ordered bucket ids, most emphasised first. Ids rather than names because
   * buckets are renameable; unknown ids are skipped on read, since a bucket can
   * be retired after a day was emphasised (SPEC §1 principle 7).
   */
  bucketIds: jsonb("bucket_ids").$type<string[]>().notNull(),
  /** optional one line, in the person's own words */
  note: text("note"),
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
export type FocusScoreRow = typeof focusScores.$inferSelect;
export type NewFocusScoreRow = typeof focusScores.$inferInsert;
export type EnergyLogRow = typeof energyLog.$inferSelect;
export type NewEnergyLogRow = typeof energyLog.$inferInsert;
export type WeeklyTarget = typeof weeklyTargets.$inferSelect;
export type NewWeeklyTarget = typeof weeklyTargets.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
