CREATE TYPE "public"."block_kind" AS ENUM('task', 'fixed', 'habit', 'break');--> statement-breakpoint
CREATE TYPE "public"."block_status" AS ENUM('planned', 'done', 'partial', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."bucket_status" AS ENUM('active', 'achieved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('deep', 'shallow', 'admin');--> statement-breakpoint
CREATE TYPE "public"."commitment_source" AS ENUM('manual', 'timetable');--> statement-breakpoint
CREATE TYPE "public"."energy_level" AS ENUM('fried', 'ok', 'sharp');--> statement-breakpoint
CREATE TYPE "public"."exam_kind" AS ENUM('mid_block', 'end_block', 'other');--> statement-breakpoint
CREATE TYPE "public"."overflow_action" AS ENUM('defer', 'shrink', 'delegate', 'drop');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'committed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('dump', 'manual', 'carryover');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('inbox', 'active', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."weekly_target_status" AS ENUM('planned', 'hit', 'missed', 'partial', 'dropped');--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"task_id" uuid,
	"habit_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"kind" "block_kind" NOT NULL,
	"title" text NOT NULL,
	"category" "category" NOT NULL,
	"reason" text NOT NULL,
	"estimate_min" integer NOT NULL,
	"raw_estimate_min" integer NOT NULL,
	"status" "block_status" DEFAULT 'planned' NOT NULL,
	"actual_min" integer,
	"logged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bucket_emphasis" (
	"date" date PRIMARY KEY NOT NULL,
	"bucket_ids" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"outcome" text,
	"outcome_target_date" date,
	"status" "bucket_status" DEFAULT 'active' NOT NULL,
	"breakdown_transcript" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buckets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "calibration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"ratio" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"sample_n" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"recurrence" text,
	"source" "commitment_source" DEFAULT 'manual' NOT NULL,
	"timetable_import_id" uuid
);
--> statement-breakpoint
CREATE TABLE "day_profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"work_windows" jsonb NOT NULL,
	"daily_cap_min" integer NOT NULL,
	"protected_blocks" jsonb NOT NULL,
	"min_block_min" integer DEFAULT 30 NOT NULL,
	"max_block_min" integer DEFAULT 150 NOT NULL,
	"break_min" integer DEFAULT 15 NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	CONSTRAINT "day_profile_singleton" CHECK ("day_profile"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "energy_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"minute_of_day" integer NOT NULL,
	"level" "energy_level" NOT NULL,
	"source" text DEFAULT 'checkin' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_code" text NOT NULL,
	"subject_name" text,
	"kind" "exam_kind" DEFAULT 'other' NOT NULL,
	"date" date NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"location" text,
	"bucket_id" uuid,
	"timetable_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_subject_date_kind_uq" UNIQUE("subject_code","date","kind")
);
--> statement-breakpoint
CREATE TABLE "focus_scores" (
	"hour" integer PRIMARY KEY NOT NULL,
	"score" numeric(4, 2),
	"mean_ratio" numeric(4, 2),
	"skip_rate" numeric(4, 2) DEFAULT '0' NOT NULL,
	"sample_n" integer DEFAULT 0 NOT NULL,
	"manual_score" numeric(4, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_scores_hour_range" CHECK ("focus_scores"."hour" >= 0 and "focus_scores"."hour" <= 23)
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cadence" jsonb NOT NULL,
	"duration_min" integer NOT NULL,
	"preferred_window" text,
	"bucket_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"action" "overflow_action" NOT NULL,
	"suggestion" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text,
	"input_snapshot" jsonb,
	"output_snapshot" jsonb,
	"parent_plan_id" uuid,
	"debriefed_at" timestamp with time zone,
	"debrief_summary" text
);
--> statement-breakpoint
CREATE TABLE "seed_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_ids" jsonb NOT NULL,
	"bucket_ids" jsonb NOT NULL,
	"habit_ids" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"bucket_id" uuid,
	"category" "category" NOT NULL,
	"estimate_min" integer,
	"due_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'inbox' NOT NULL,
	"weekly_target_id" uuid,
	"must_do_today" boolean DEFAULT false NOT NULL,
	"defer_count" integer DEFAULT 0 NOT NULL,
	"source" "task_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "time_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"bucket_id" uuid,
	"task_id" uuid,
	"category" "category" NOT NULL,
	"planned_start_at" timestamp with time zone,
	"raw_estimate_min" integer,
	"energy_level" "energy_level",
	"kind" "block_kind",
	"planned" boolean DEFAULT true NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "timetable_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_name" text,
	"instruction" text,
	"range_start" date NOT NULL,
	"range_end" date NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"description" text NOT NULL,
	"target_hours" numeric(5, 2),
	"status" "weekly_target_status" DEFAULT 'planned' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_timetable_import_id_timetable_imports_id_fk" FOREIGN KEY ("timetable_import_id") REFERENCES "public"."timetable_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_timetable_import_id_timetable_imports_id_fk" FOREIGN KEY ("timetable_import_id") REFERENCES "public"."timetable_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overflow" ADD CONSTRAINT "overflow_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overflow" ADD CONSTRAINT "overflow_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_parent_plan_id_plans_id_fk" FOREIGN KEY ("parent_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_weekly_target_id_weekly_targets_id_fk" FOREIGN KEY ("weekly_target_id") REFERENCES "public"."weekly_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_targets" ADD CONSTRAINT "weekly_targets_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_plan_id_idx" ON "blocks" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_key_uq" ON "calibration" USING btree ("key");--> statement-breakpoint
CREATE INDEX "energy_log_date_idx" ON "energy_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX "exams_date_idx" ON "exams" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_committed_per_date" ON "plans" USING btree ("date") WHERE "plans"."status" = 'committed';--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_due_at_idx" ON "tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "weekly_targets_week_idx" ON "weekly_targets" USING btree ("week_start");