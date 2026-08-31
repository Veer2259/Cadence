CREATE TABLE "seed_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_ids" jsonb NOT NULL,
	"bucket_ids" jsonb NOT NULL,
	"habit_ids" jsonb NOT NULL
);
