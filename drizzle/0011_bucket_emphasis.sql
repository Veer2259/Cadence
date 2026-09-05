-- Per-date bucket emphasis: "today, CV matters more than case comp".
--
-- One row per IST date. bucket_ids is an ORDERED array, most emphasised first;
-- naming a single bucket is a one-element list. Fed into compose as a
-- PREFERENCE, never a constraint — see lib/emphasis.ts.
--
-- Written by hand rather than generated: the drizzle snapshots for 0008-0010
-- are stale (frozen at the pre-0008 schema), so `drizzle-kit generate` wanted
-- to re-create weekly_targets and focus_scores and re-drop milestones against
-- a live database. This migration is exactly the one new table and nothing else.
CREATE TABLE IF NOT EXISTS "bucket_emphasis" (
  "date" date PRIMARY KEY NOT NULL,
  "bucket_ids" jsonb NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
