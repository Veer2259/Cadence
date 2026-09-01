import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buckets as bucketsTable, tasks , weeklyTargets as weeklyTargetsTable } from "@/db/schema";
import { formatIst, istDateString } from "@/lib/time";
import { AddTaskForm } from "@/components/inbox/add-task-form";
import { BrainDump } from "@/components/inbox/brain-dump";
import { InboxControls } from "@/components/inbox/inbox-controls";
import { TaskRow, type TaskView } from "@/components/inbox/task-row";

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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">Inbox</h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          Everything on your mind. Confirm what is real; the planner only sees
          active tasks.
        </p>
      </div>

      <BrainDump buckets={bucketOpts} />
      <AddTaskForm buckets={bucketOpts} />

      {waiting.length > 0 ? (
        <section>
          <h2 className="mb-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
            Waiting for review · {waiting.length}
          </h2>
          <ul className="border-t border-rule">
            {waiting.map((t) => (
              <TaskRow key={t.id} task={t} buckets={bucketOpts} targets={allTargets} />
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
            Active · {active.length}
          </h2>
          {allBuckets.length > 0 ? (
            <InboxControls buckets={allBuckets} bucket={bucketFilter} sort={sort} />
          ) : null}
        </div>

        {active.length > 0 ? (
          <ul className="border-t border-rule">
            {active.map((t) => (
              <TaskRow key={t.id} task={t} buckets={bucketOpts} targets={allTargets} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-rule py-6 text-sm text-ink-muted">
            {rows.length === 0 && !bucketFilter
              ? "Nothing here yet. Add your first task above."
              : "Nothing active with this filter."}
          </p>
        )}
      </section>
    </div>
  );
}
