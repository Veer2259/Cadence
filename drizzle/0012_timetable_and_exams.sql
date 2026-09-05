-- Timetable import + exams.
--
-- Hand-written for the same reason 0011 was: the drizzle snapshots for
-- 0008-0010 are stale, so `drizzle-kit generate` wants to re-create
-- weekly_targets and re-drop milestones against a live database.

ALTER TYPE "commitment_source" ADD VALUE IF NOT EXISTS 'timetable';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "exam_kind" AS ENUM ('mid_block', 'end_block', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "timetable_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "file_name" text,
  "instruction" text,
  "range_start" date NOT NULL,
  "range_end" date NOT NULL,
  "session_count" integer DEFAULT 0 NOT NULL,
  "excluded_count" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

ALTER TABLE "commitments"
  ADD COLUMN IF NOT EXISTS "timetable_import_id" uuid
  REFERENCES "timetable_imports"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "exams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_code" text NOT NULL,
  "subject_name" text,
  "kind" "exam_kind" DEFAULT 'other' NOT NULL,
  "date" date NOT NULL,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "location" text,
  "bucket_id" uuid REFERENCES "buckets"("id") ON DELETE SET NULL,
  "timetable_import_id" uuid REFERENCES "timetable_imports"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "exams_subject_date_kind_uq" UNIQUE("subject_code","date","kind")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "exams_date_idx" ON "exams" ("date");
