CREATE TYPE "public"."block_kind" AS ENUM('task', 'fixed', 'habit', 'break');--> statement-breakpoint
CREATE TYPE "public"."block_status" AS ENUM('planned', 'done', 'partial', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."calibration_scope" AS ENUM('category', 'bucket');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('deep', 'shallow', 'calls', 'admin', 'errand', 'personal');--> statement-breakpoint
CREATE TYPE "public"."commitment_source" AS ENUM('manual', 'gcal');--> statement-breakpoint
CREATE TYPE "public"."overflow_action" AS ENUM('defer', 'shrink', 'delegate', 'drop');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'committed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('dump', 'manual', 'voice', 'carryover');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('inbox', 'active', 'done', 'dropped');--> statement-breakpoint
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
	"actual_min" integer
);
--> statement-breakpoint
CREATE TABLE "buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"priority_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buckets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "calibration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "calibration_scope" NOT NULL,
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
	"gcal_event_id" text
);
--> statement-breakpoint
CREATE TABLE "day_profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"work_windows" jsonb NOT NULL,
	"sharp_hours" jsonb NOT NULL,
	"daily_cap_min" integer NOT NULL,
	"protected_blocks" jsonb NOT NULL,
	"min_block_min" integer DEFAULT 30 NOT NULL,
	"max_block_min" integer DEFAULT 150 NOT NULL,
	"break_min" integer DEFAULT 15 NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	CONSTRAINT "day_profile_singleton" CHECK ("day_profile"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cadence" text NOT NULL,
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
	"parent_plan_id" uuid
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
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'inbox' NOT NULL,
	"parent_id" uuid,
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
	"planned" boolean DEFAULT true NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overflow" ADD CONSTRAINT "overflow_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overflow" ADD CONSTRAINT "overflow_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_parent_plan_id_plans_id_fk" FOREIGN KEY ("parent_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_plan_id_idx" ON "blocks" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_scope_key_uq" ON "calibration" USING btree ("scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_live_per_date" ON "plans" USING btree ("date") WHERE "plans"."status" in ('draft', 'committed');--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_due_at_idx" ON "tasks" USING btree ("due_at");