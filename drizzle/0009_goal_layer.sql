-- The goal layer. Supersedes the milestones table added in 0008, which was
-- verified empty (0 rows, 0 tasks linked) before this migration was written —
-- no data is lost by the drop.
--
-- Everything a task or bucket gains here is NULLable: a bucket with no outcome
-- and a task with no weekly target behave exactly as they did before.

CREATE TYPE "public"."bucket_status" AS ENUM('active', 'achieved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."weekly_target_status" AS ENUM('planned', 'hit', 'missed', 'partial', 'dropped');--> statement-breakpoint

-- buckets carry the outcome: what "done" looks like, and by when
ALTER TABLE "buckets" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "outcome_target_date" date;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "status" "bucket_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "breakdown_transcript" jsonb;--> statement-breakpoint

CREATE TABLE "weekly_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"description" text NOT NULL,
	"target_hours" numeric(5, 2),
	"status" "weekly_target_status" DEFAULT 'planned' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "weekly_targets" ADD CONSTRAINT "weekly_targets_bucket_id_buckets_id_fk"
	FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_targets_week_idx" ON "weekly_targets" USING btree ("week_start");--> statement-breakpoint

-- tasks point at a week's target instead of a milestone. Optional, always.
ALTER TABLE "tasks" DROP COLUMN "milestone_id";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "weekly_target_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_weekly_target_id_weekly_targets_id_fk"
	FOREIGN KEY ("weekly_target_id") REFERENCES "public"."weekly_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

DROP TABLE "milestones";
