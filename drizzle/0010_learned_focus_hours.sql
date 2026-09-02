-- Learned focus hours replace declared sharp hours.
--
-- Being asked to predict when you think clearly is a guess, and that guess
-- contradicted the work windows badly enough to defer real work: only 90 min of
-- declared sharp time fell inside a working window against 180 min of deep
-- work, so a task was deferred with 235 free minutes in the day.
--
-- day_profile.sharp_hours is DROPPED. Nothing migrates into focus_scores: the
-- declared values were the guess being removed, and seeding the learned table
-- from them would import exactly the bias this change exists to eliminate.
-- The table starts empty and compose is told to say so.

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
ALTER TABLE "day_profile" DROP COLUMN "sharp_hours";
