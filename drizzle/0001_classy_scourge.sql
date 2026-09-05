ALTER TABLE "plans" DROP CONSTRAINT "plans_parent_plan_id_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "parent_plan_id";