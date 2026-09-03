import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buckets as bucketsTable, tasks , weeklyTargets as weeklyTargetsTable } from "@/db/schema";
import { formatIst, istDateString } from "@/lib/time";
import { AddTaskForm } from "@/components/inbox/add-task-form";
import { BrainDump } from "@/components/inbox/brain-dump";
import { InboxControls } from "@/components/inbox/inbox-controls";
import { TaskRow, type TaskView } from "@/components/inbox/task-row";


/**
 * Server Actions inherit maxDuration from the PAGE segment they are invoked
 * from, not from the file they live in (Next.js route-segment config). Covers capture (the brain dump).
 * 
 * 300s is the Fluid compute ceiling on Vercel's Hobby plan. It is a ceiling,
 * not a reservation — a fast call still costs only what it uses.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const bucketFilter = typeof sp.bucket === "string" && sp.bucket ? sp.bucket : null;
  const sort: "due" | "created" = sp.sort === "created" ? "created" : "due";

  const allBuckets = await db
    .select({ id: bucketsTable.id, name: bucketsTable.name })
    .from(bucketsTable)
    .where(eq(bucketsTable.active, true))
    .orderBy(bucketsTable.name);
  const bucketName = new Map(allBuckets.map((b) => [b.id, b.name]));

  // this week's targets a task MAY be linked to — always optional
  const allTargets = await db
    .select({ id: weeklyTargetsTable.id, name: weeklyTargetsTable.description })
    .from(weeklyTargetsTable)
    .orderBy(weeklyTargetsTable.weekStart);
  const targetName = new Map(allTargets.map((m) => [m.id, m.name]));

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["inbox", "active"]),
        sql`${tasks.parentId} is null`,
        bucketFilter ? eq(tasks.bucketId, bucketFilter) : undefined,
      ),
    )
    .orderBy(
      sort === "due"
        ? sql`${tasks.dueAt} asc nulls last, ${tasks.createdAt} asc`
        : sql`${tasks.createdAt} desc`,
    );

  const toView = (t: (typeof rows)[number]): TaskView => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    category: t.category,
    priority: t.priority,
    status: t.status as TaskView["status"],
    estimateMin: t.estimateMin,
    deferCount: t.deferCount,
    mustDoToday: t.mustDoToday,
    bucketId: t.bucketId,
    bucketName: t.bucketId ? (bucketName.get(t.bucketId) ?? null) : null,
    weeklyTargetId: t.weeklyTargetId,
    weeklyTargetName: t.weeklyTargetId ? (targetName.get(t.weeklyTargetId) ?? null) : null,
    dueDateValue: t.dueAt ? istDateString(t.dueAt) : "",
    dueLabel: t.dueAt ? formatIst(t.dueAt, "d MMM") : "",
  });

  const waiting = rows.filter((t) => t.status === "inbox").map(toView);
  const active = rows.filter((t) => t.status === "active").map(toView);
  const bucketOpts = allBuckets;

  return (
    <div className="animate-rise-in flex flex-col gap-3">
      <div>
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Inbox
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] font-medium text-ink-muted">
          Everything not on a day yet. Confirm what&rsquo;s real, drop what
          isn&rsquo;t.
        </p>
      </div>

      {/* The capture SHEET lives on the + in the tab bar. This is the same
          brain dump inline, for when you are already on this screen. */}
      <BrainDump buckets={bucketOpts} />
      <AddTaskForm buckets={bucketOpts} />

      {allBuckets.length > 0 ? (
        <InboxControls buckets={allBuckets} bucket={bucketFilter} sort={sort} />
      ) : null}

      {waiting.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
            Waiting for review · {waiting.length}
          </h2>
          <ul className="flex flex-col gap-2.5">
            {waiting.map((t) => (
              <TaskRow key={t.id} task={t} buckets={bucketOpts} targets={allTargets} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
          Active · {active.length}
        </h2>

        {active.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {active.map((t) => (
              <TaskRow key={t.id} task={t} buckets={bucketOpts} targets={allTargets} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[18px] bg-surface px-4 py-6 text-[13.5px] font-medium text-ink-muted shadow-card">
            {rows.length === 0 && !bucketFilter
              ? "Nothing waiting. Type a brain dump to get started."
              : "Nothing active with this filter."}
          </p>
        )}
      </section>
    </div>
  );
}
