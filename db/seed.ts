/**
 * db/seed.ts — fills an empty database with something realistic to look at.
 *
 *   npm run db:seed            # only runs if buckets + tasks are empty
 *   npm run db:seed -- --force # wipe buckets / tasks / habits first, then seed
 *
 * SPEC note 13: generically-named buckets only (never a real project name),
 * a realistic day profile, ~15 tasks spread across categories and due dates.
 */

import "./load-env";

import { sql } from "drizzle-orm";
import { db } from "./index";
import { buckets, tasks, habits, dayProfile } from "./schema";
import { DEFAULT_DAY_PROFILE } from "../lib/day-profile";

const force = process.argv.includes("--force");

/** days-from-now -> a UTC Date at 18:30 IST (13:00 UTC) on that day */
function due(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

async function main() {
  const [{ count: bucketCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buckets);
  const [{ count: taskCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks);

  if ((bucketCount > 0 || taskCount > 0) && !force) {
    console.log(
      `Database already has ${bucketCount} buckets and ${taskCount} tasks — leaving it alone.\n` +
        `Run  npm run db:seed -- --force  to wipe and reseed.`,
    );
    return;
  }

  if (force) {
    console.log("Wiping tasks, habits, buckets…");
    await db.delete(tasks);
    await db.delete(habits);
    await db.delete(buckets);
  }

  // --- day profile (singleton) ---
  await db
    .insert(dayProfile)
    .values(DEFAULT_DAY_PROFILE)
    .onConflictDoUpdate({ target: dayProfile.id, set: DEFAULT_DAY_PROFILE });
  console.log("Day profile set.");

  // --- buckets: generic names only ---
  const bucketRows = await db
    .insert(buckets)
    .values([
      { name: "work", color: "#2f5d50", priorityHint: "weekday priority" },
      { name: "side-project", color: "#8c1d18", priorityHint: "evenings and weekends" },
      { name: "learning", color: "#a67c00" },
      { name: "home", color: "#6b7178" },
    ])
    .returning({ id: buckets.id, name: buckets.name });
  const b = Object.fromEntries(bucketRows.map((r) => [r.name, r.id])) as Record<
    string,
    string
  >;
  console.log(`Inserted ${bucketRows.length} buckets.`);

  // --- habits ---
  await db.insert(habits).values([
    {
      name: "gym",
      cadence: "3x/week",
      durationMin: 60,
      preferredWindow: "06:30-08:00",
      bucketId: b.home,
    },
    {
      name: "reading",
      cadence: "daily",
      durationMin: 30,
      preferredWindow: "evening",
      bucketId: b.learning,
    },
  ]);
  console.log("Inserted 2 habits.");

  // --- tasks: ~15, spread across categories, priorities, due dates ---
  const rows = [
    { title: "Write Q3 planning brief", notes: "Two pages, decision-focused.", bucketId: b.work, category: "deep", estimateMin: 120, dueAt: due(1), priority: "high", status: "active", source: "manual" },
    { title: "Review three vendor proposals", bucketId: b.work, category: "deep", estimateMin: 90, dueAt: due(2), priority: "normal", status: "active", source: "manual" },
    { title: "Reply to the outstanding client thread", bucketId: b.work, category: "shallow", estimateMin: 25, dueAt: due(0), priority: "high", status: "active", source: "manual" },
    { title: "Call the accountant about the filing", bucketId: b.work, category: "calls", estimateMin: 20, dueAt: due(-1), priority: "high", status: "active", source: "manual", deferCount: 2 },
    { title: "Submit the reimbursement form", bucketId: b.work, category: "admin", estimateMin: 15, dueAt: due(3), priority: "low", status: "active", source: "manual" },
    { title: "Prototype the onboarding screen", bucketId: b["side-project"], category: "deep", estimateMin: 150, dueAt: due(4), priority: "normal", status: "active", source: "manual" },
    { title: "Fix the sign-up validation bug", bucketId: b["side-project"], category: "deep", estimateMin: 60, dueAt: due(2), priority: "high", status: "active", source: "manual" },
    { title: "Draft the launch announcement", bucketId: b["side-project"], category: "shallow", estimateMin: 45, dueAt: due(6), priority: "normal", status: "active", source: "dump" },
    { title: "Work through chapter 4 exercises", bucketId: b.learning, category: "deep", estimateMin: 75, dueAt: due(5), priority: "low", status: "active", source: "manual" },
    { title: "Watch the systems-design lecture", bucketId: b.learning, category: "shallow", estimateMin: 50, dueAt: null, priority: "low", status: "active", source: "manual" },
    { title: "Renew the car insurance", bucketId: b.home, category: "admin", estimateMin: 30, dueAt: due(7), priority: "normal", status: "active", source: "manual" },
    { title: "Pick up the dry cleaning", bucketId: b.home, category: "errand", estimateMin: 20, dueAt: due(1), priority: "low", status: "active", source: "manual" },
    { title: "Plan the weekend trip", bucketId: b.home, category: "personal", estimateMin: 40, dueAt: due(9), priority: "low", status: "active", source: "dump" },
    { title: "Book the dentist appointment", bucketId: b.home, category: "calls", estimateMin: 10, dueAt: null, priority: "normal", status: "inbox", source: "dump" },
    { title: "Think about next quarter's goals", notes: "Vague — needs breaking down.", bucketId: b.work, category: "deep", estimateMin: 60, dueAt: null, priority: "normal", status: "inbox", source: "dump" },
  ] as const;

  await db.insert(tasks).values(rows.map((r) => ({ ...r })));
  console.log(`Inserted ${rows.length} tasks.`);

  console.log("\nSeed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
