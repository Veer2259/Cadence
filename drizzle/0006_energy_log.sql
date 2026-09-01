CREATE TYPE "public"."energy_level" AS ENUM('fried', 'ok', 'sharp');--> statement-breakpoint
CREATE TABLE "energy_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"minute_of_day" integer NOT NULL,
	"level" "energy_level" NOT NULL,
	"source" text DEFAULT 'checkin' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "energy_log_date_idx" ON "energy_log" USING btree ("date");