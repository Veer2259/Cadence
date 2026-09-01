/**
 * db/seed.ts — fill an empty database with something realistic to look at.
 *
 *   npm run db:seed              # only runs on an empty database
 *   npm run db:seed -- --force   # wipe + reseed, but ONLY after showing you
 *                                # exactly what it will delete and asking you to
 *                                # type "yes" in an interactive terminal
 *
 * Guard: the seed records the ids it creates in the `seed_runs` table. It will
 * REFUSE to run if the database contains any task it did not create itself,
 * unless --force is passed with interactive confirmation. It never deletes data
 * silently.
 *
 * SPEC note 13: generically-named buckets only (never a real project name),
 * a realistic day profile, ~15 tasks spread across categories and due dates.
 */

import "./load-env";

import { db, closeDb } from "./index";
import { buckets, tasks, habits, dayProfile, seedRuns } from "./schema";
import { DEFAULT_DAY_PROFILE } from "../lib/day-profile";
import { confirmDestructive } from "./confirm";

const force = process.argv.includes("--force");

/** days-from-now -> a UTC Date at 18:30 IST (13:00 UTC) on that day */
function due(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

/** Every task id recorded by a previous seed run, or null if we can't tell. */
async function knownSeededTaskIds(): Promise<Set<string> | null> {
  try {
    const runs = await db.select({ taskIds: seedRuns.taskIds }).from(seedRuns);
    return new Set(runs.flatMap((r) => r.taskIds ?? []));
  } catch {
    return null; // table missing — migrations not run yet
  }
}

async function insertSeedData() {
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
  const habitRows = await db
    .insert(habits)
    .values([
      {
        name: "gym",
        cadence: { kind: "per_week", count: 3 },
        durationMin: 60,
        preferredWindow: "06:30-08:00",
        bucketId: b.home,
      },
      {
        name: "reading",
        cadence: { kind: "daily" },
        durationMin: 30,
        preferredWindow: "evening",
        bucketId: b.learning,
      },
    ])
    .returning({ id: habits.id });
  console.log(`Inserted ${habitRows.length} habits.`);

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

  const taskRows = await db
    .insert(tasks)
    .values(rows.map((r) => ({ ...r })))
    .returning({ id: tasks.id });
  console.log(`Inserted ${taskRows.length} tasks.`);

  await db.insert(seedRuns).values({
    taskIds: taskRows.map((r) => r.id),
    bucketIds: bucketRows.map((r) => r.id),
    habitIds: habitRows.map((r) => r.id),
  });
}

async function main() {
  const [currentTasks, currentBuckets, currentHabits] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title }).from(tasks),
    db.select({ id: buckets.id, name: buckets.name }).from(buckets),
    db.select({ id: habits.id, name: habits.name }).from(habits),
  ]);

  const known = await knownSeededTaskIds();
  const foreign = currentTasks.filter((t) => !known?.has(t.id));
  const empty =
    currentTasks.length === 0 && currentBuckets.length === 0 && currentHabits.length === 0;

  // ---------------------------------------------------------------- no --force
  if (!force) {
    if (empty) {
      await insertSeedData();
      console.log("\nSeed complete.");
      return;
    }
    if (foreign.length > 0) {
      console.error(
        `\nRefusing to seed: the database has ${foreign.length} task(s) that were ` +
          `not created by a previous seed run` +
          (known === null ? " (could not read seed history — run `npm run db:migrate`)" : "") +
          `.\n\nExamples:\n` +
          foreign.slice(0, 8).map((t) => `  · ${t.title}`).join("\n") +
          (foreign.length > 8 ? `\n  · …and ${foreign.length - 8} more` : "") +
          `\n\nThis looks like data you entered. If you really want to wipe it,\n` +
          `run:  npm run db:seed -- --force\n` +
          `(it will list everything it deletes and ask you to type "yes").`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Database already seeded — ${currentTasks.length} task(s), all from a previous ` +
        `seed run. Nothing to do.\nRun  npm run db:seed -- --force  to wipe and reseed.`,
    );
    return;
  }

  // ------------------------------------------------------------------- --force
  const manifest = [
    "--force: the following rows will be PERMANENTLY DELETED:",
    "",
    `  tasks   (${currentTasks.length}):`,
    ...currentTasks.map(
      (t) =>
        `    · ${t.title}${foreign.some((f) => f.id === t.id) ? "  ← NOT from a seed run" : ""}`,
    ),
    `  buckets (${currentBuckets.length}): ${currentBuckets.map((x) => x.name).join(", ") || "—"}`,
    `  habits  (${currentHabits.length}): ${currentHabits.map((x) => x.name).join(", ") || "—"}`,
  ];
  if (foreign.length > 0) {
    manifest.push(
      "",
      `  ⚠  ${foreign.length} of these task(s) were NOT created by a seed run — ` +
        "they look like data you entered by hand.",
    );
  }

  const ok = await confirmDestructive(
    manifest,
    'Type exactly "yes" to delete everything above and reseed: ',
  );
  if (!ok) {
    process.exitCode = 1;
    return;
  }

  console.log("\nWiping tasks, habits, buckets, seed history…");
  await db.delete(tasks);
  await db.delete(habits);
  await db.delete(buckets);
  await db.delete(seedRuns);

  await insertSeedData();
  console.log("\nSeed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
