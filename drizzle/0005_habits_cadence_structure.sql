-- habits.cadence: free text -> structured jsonb (HabitCadence).
--   "daily" / "every day"          -> {"kind":"daily"}
--   "5x/week" / "5 times a week"    -> {"kind":"per_week","count":5}
--   "mon,wed,fri"                   -> {"kind":"days","days":["mon","wed","fri"]}
--   anything else                   -> {"kind":"per_week","count":3}
-- Done as add-column / backfill / swap because text -> jsonb has no implicit cast.

ALTER TABLE "habits" ADD COLUMN "cadence_j" jsonb;
--> statement-breakpoint

UPDATE "habits" SET "cadence_j" = CASE
  WHEN lower(btrim("cadence")) IN ('daily', 'every day')
    THEN '{"kind":"daily"}'::jsonb
  WHEN lower("cadence") ~ '[0-9]+\s*(x|times)?\s*(/|per|a| )?\s*week'
    THEN jsonb_build_object(
      'kind', 'per_week',
      'count', least(7, greatest(1, (regexp_match(lower("cadence"), '[0-9]+'))[1]::int))
    )
  WHEN lower("cadence") ~ '(mon|tue|wed|thu|fri|sat|sun)'
    THEN jsonb_build_object(
      'kind', 'days',
      'days', to_jsonb(ARRAY(
        SELECT d FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) AS d
        WHERE lower("cadence") LIKE '%' || d || '%'
      ))
    )
  ELSE '{"kind":"per_week","count":3}'::jsonb
END;
--> statement-breakpoint

ALTER TABLE "habits" DROP COLUMN "cadence";
--> statement-breakpoint
ALTER TABLE "habits" RENAME COLUMN "cadence_j" TO "cadence";
--> statement-breakpoint
ALTER TABLE "habits" ALTER COLUMN "cadence" SET NOT NULL;
