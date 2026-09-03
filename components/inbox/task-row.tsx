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

/** A stable colour per bucket name, so the same bucket reads the same everywhere. */
const DOTS = [
  "var(--color-bucket-growth)",
  "var(--color-bucket-churn)",
  "var(--color-bucket-ops)",
  "var(--color-bucket-personal)",
];
function bucketDot(name: string | null): string {
  if (!name) return "var(--color-bucket-fixed)";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DOTS[h % DOTS.length];
}

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
  variant?: "primary" | "dark" | "quiet" | "danger";
}) {
  return (
    <form action={setTaskStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant}>
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
    <li
      className={`rounded-[18px] bg-surface p-3.5 ${editing ? "shadow-open" : "shadow-card"}`}
    >
      {/* The whole row is the disclosure control — a 14px chevron is not a tap
          target, and this card is used one-handed. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={editing}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span
          aria-hidden
          className="block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: bucketDot(task.bucketName) }}
        />
        <span className="min-w-0 flex-1">
          {task.mustDoToday ? (
            <span className="mb-1 inline-block rounded-full bg-warn-tint px-2 py-0.5 text-[10px] font-extrabold tracking-[0.06em] text-warn uppercase">
              Must do today
            </span>
          ) : null}
          <span className="block truncate text-[14.5px] font-bold text-ink">
            {task.title}
          </span>
          <span className="block truncate text-[11.5px] font-semibold text-ink-faint">
            {task.bucketName ? `${task.bucketName} · ` : ""}
            {meta.join(" · ")}
          </span>
        </span>
        <span
          aria-hidden
          className="shrink-0 text-ink-ghost transition-transform duration-[180ms]"
          style={{ transform: editing ? "rotate(90deg)" : "none" }}
        >
          ›
        </span>
      </button>

      {editing ? (
        <div className="mt-3 flex flex-wrap gap-2">
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
            <StatusButton id={task.id} status="active" variant="primary">
              Confirm
            </StatusButton>
          ) : null}
          {task.status === "active" ? (
            <StatusButton id={task.id} status="done" variant="quiet">
              Done
            </StatusButton>
          ) : null}
          {task.status !== "dropped" ? (
            <StatusButton id={task.id} status="dropped" variant="danger">
              Drop
            </StatusButton>
          ) : (
            <StatusButton id={task.id} status="active" variant="quiet">
              Restore
            </StatusButton>
          )}
        </div>
      ) : null}

      {editing ? (
        <form onSubmit={onSubmit} className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3">
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
            <ul role="alert" className="w-full list-disc pl-5 text-xs font-semibold text-warn">
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
              className="text-xs font-bold text-warn underline underline-offset-2"
            >
              Delete permanently
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
