CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_date" date NOT NULL,
	"bucket_id" uuid,
	"completed_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "logged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "weekly_target_min" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "time_log" ADD COLUMN "planned_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_log" ADD COLUMN "raw_estimate_min" integer;--> statement-breakpoint
ALTER TABLE "time_log" ADD COLUMN "energy_level" "energy_level";--> statement-breakpoint
ALTER TABLE "time_log" ADD COLUMN "kind" "block_kind";--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestones_target_date_idx" ON "milestones" USING btree ("target_date");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;