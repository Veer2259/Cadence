DROP INDEX "plans_one_live_per_date";--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_committed_per_date" ON "plans" USING btree ("date") WHERE "plans"."status" = 'committed';