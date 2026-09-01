"use client";

import {
  patchTask,
  setTaskStatus,
  toggleMustDoToday,
  deleteTask,
} from "@/app/(app)/inbox/actions";
import { CATEGORIES, PRIORITIES } from "@/lib/schemas";
import { Button, Input, Labeled, Select, Textarea } from "@/components/ui/controls";
import { useEditorForm } from "@/components/ui/use-editor-form";

export type TaskView = {
  id: string;
  title: string;
  notes: string | null;
  category: string;
  priority: string;
  status: "inbox" | "active" | "done" | "dropped";
  mustDoToday: boolean;
  weeklyTargetId: string | null;
  weeklyTargetName: string | null;
  estimateMin: number | null;
  deferCount: number;
  bucketId: string | null;
  bucketName: string | null;
  dueDateValue: string; // "" or YYYY-MM-DD
  dueLabel: string; // "" or human label
};

function StatusButton({
  id,
  status,
  children,
  variant = "quiet",
}: {
  id: string;
  status: string;
  children: React.ReactNode;
  variant?: "solid" | "quiet" | "danger";
}) {
  return (
    <form action={setTaskStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} className="px-2 py-1 text-xs">
        {children}
      </Button>
    </form>
  );
}

export function TaskRow({
  task,
  targets = [],
  buckets,
}: {
  task: TaskView;
  buckets: { id: string; name: string }[];
  targets?: { id: string; name: string }[];
}) {
  const { editing, toggle, errors, pending, onSubmit, runVoid } =
    useEditorForm(patchTask);

  const meta = [
    task.category,
    task.estimateMin ? `${task.estimateMin}m` : "no est.",
    task.priority !== "normal" ? task.priority : null,
    task.dueLabel ? `due ${task.dueLabel}` : null,
    task.deferCount > 0 ? `deferred ${task.deferCount}×` : null,
    task.weeklyTargetName ? `→ ${task.weeklyTargetName}` : null,
  ].filter(Boolean);

  function del() {
    if (!confirm("Delete this task permanently? This cannot be undone.")) return;
    const fd = new FormData();
    fd.set("id", task.id);
    runVoid(() => deleteTask(fd));
  }

  return (
    <li className="border-b border-rule py-2 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">
            {task.mustDoToday ? (
              <span
                className="mr-1.5 border border-signal px-1 py-0.5 align-middle font-mono text-[10px] tracking-wide text-signal uppercase"
                style={{ borderRadius: "var(--radius)" }}
                title="Must do today — compose cannot defer this"
              >
                must
              </span>
            ) : null}
            {task.title}
          </p>
          <p className="tabular mt-0.5 text-xs text-ink-muted">
            {task.bucketName ? `${task.bucketName} · ` : ""}
            {meta.join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {task.status === "active" || task.status === "inbox" ? (
            <form action={toggleMustDoToday}>
              <input type="hidden" name="id" value={task.id} />
              <input
                type="hidden"
                name="mustDoToday"
                value={task.mustDoToday ? "false" : "true"}
              />
              <Button
                type="submit"
                variant={task.mustDoToday ? "danger" : "quiet"}
                className="px-2 py-1 text-xs"
                title={
                  task.mustDoToday
                    ? "Remove the must-do-today flag"
                    : "Mark must-do-today — a hard constraint the planner cannot defer"
                }
              >
                {task.mustDoToday ? "Must ✓" : "Must"}
              </Button>
            </form>
          ) : null}
          {task.status === "inbox" ? (
            <StatusButton id={task.id} status="active" variant="solid">
              Confirm
            </StatusButton>
          ) : null}
          {task.status === "active" ? (
            <StatusButton id={task.id} status="done">
              Done
            </StatusButton>
          ) : null}
          {task.status !== "dropped" ? (
            <StatusButton id={task.id} status="dropped">
              Drop
            </StatusButton>
          ) : (
            <StatusButton id={task.id} status="active">
              Restore
            </StatusButton>
          )}
          <Button
            type="button"
            variant="quiet"
            className="px-2 py-1 text-xs"
            onClick={toggle}
          >
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-2 flex flex-wrap gap-3 border-t border-rule pt-3">
          <input type="hidden" name="id" value={task.id} />
          <div className="w-full">
            <Labeled label="Title">
              <Input name="title" defaultValue={task.title} required className="w-full" />
            </Labeled>
          </div>

          <Labeled label="Category">
            <Select name="category" defaultValue={task.category}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Labeled>

          <Labeled label="Bucket">
            <Select name="bucketId" defaultValue={task.bucketId ?? ""}>
              <option value="">— none —</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Weekly target" hint="optional">
            <Select name="weeklyTargetId" defaultValue={task.weeklyTargetId ?? ""}>
              <option value="">— none —</option>
              {targets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Labeled>

          <Labeled label="Priority">
            <Select name="priority" defaultValue={task.priority}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Labeled>

          <Labeled label="Estimate (min)">
            <Input
              name="estimateMin"
              type="number"
              min={5}
              max={1440}
              step={5}
              defaultValue={task.estimateMin ?? ""}
              className="w-28"
            />
          </Labeled>

          <Labeled label="Due">
            <Input name="dueDate" type="date" defaultValue={task.dueDateValue} className="w-40" />
          </Labeled>

          <div className="w-full">
            <Labeled label="Notes">
              <Textarea name="notes" defaultValue={task.notes ?? ""} className="w-full" />
            </Labeled>
          </div>

          {errors.length > 0 ? (
            <ul role="alert" className="w-full list-disc pl-5 text-xs text-signal">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex w-full items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={del}
              className="text-xs text-signal underline underline-offset-2"
            >
              Delete permanently
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
