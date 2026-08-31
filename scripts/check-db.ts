/**
 * scripts/check-db.ts — quick read-only sanity check that the migration landed.
 * Run with:  npx tsx scripts/check-db.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const EXPECTED_TABLES = [
  "blocks",
  "buckets",
  "calibration",
  "chat_messages",
  "commitments",
  "day_profile",
  "habits",
  "overflow",
  "plans",
  "tasks",
  "time_log",
];

async function main() {
  const tables = (await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `) as { table_name: string }[];

  const names = tables.map((t) => t.table_name);
  console.log("Tables in public schema:\n");
  for (const n of names) console.log("  " + n);

  const missing = EXPECTED_TABLES.filter((t) => !names.includes(t));
  const hasMigrationsTable = names.includes("__drizzle_migrations");

  const enums = (await sql`
    select t.typname as name, count(e.enumlabel)::int as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    group by t.typname
    order by t.typname
  `) as { name: string; labels: number }[];

  console.log("\nEnums:\n");
  for (const e of enums) console.log(`  ${e.name} (${e.labels} values)`);

  const planIdx = (await sql`
    select indexname from pg_indexes
    where tablename = 'plans' and indexname = 'plans_one_live_per_date'
  `) as { indexname: string }[];

  console.log("\nChecks:");
  console.log(`  expected app tables present: ${missing.length === 0 ? "yes" : "NO — missing " + missing.join(", ")}`);
  console.log(`  drizzle migrations ledger present: ${hasMigrationsTable ? "yes" : "no (drizzle stores it in the 'drizzle' schema)"}`);
  console.log(`  partial unique index on plans present: ${planIdx.length === 1 ? "yes" : "NO"}`);

  const ledger = (await sql`
    select hash, created_at from drizzle.__drizzle_migrations order by created_at
  `.catch(() => [])) as { hash: string; created_at: string }[];
  if (ledger.length) {
    console.log("\nApplied migrations (drizzle.__drizzle_migrations):");
    for (const row of ledger) console.log(`  ${row.hash}`);
  }

  if (missing.length) process.exit(1);
  console.log("\nOK — schema is live.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
