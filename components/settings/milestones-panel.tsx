"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createMilestone,
  updateMilestone,
  deleteMilestone,
  type FormResult,
} from "@/app/(app)/settings/actions";
import { Button, Input, Labeled, Select } from "@/components/ui/controls";
import { useEditorForm } from "@/components/ui/use-editor-form";

const INITIAL: FormResult = { ok: true, errors: [] };

type MilestoneRow = {
  id: string;
  name: string;
  targetDate: string;
  bucketId: string | null;
  completedAt: string | null;
  archived: boolean;
  totalTasks: number;
  doneTasks: number;
};
type BucketOpt = { id: string; name: string };

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="mt-1 list-disc pl-5 text-xs text-signal">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

function AddMilestone({ buckets }: { buckets: BucketOpt[] }) {
  const [state, action, pending] = useActionState(createMilestone, INITIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state !== INITIAL) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Labeled label="New milestone">
        <Input name="name" placeholder="e.g. submit the thesis draft" required className="w-56" />
      </Labeled>
      <Labeled label="Target date">
        <Input name="targetDate" type="date" required className="w-40" />
      </Labeled>
      <Labeled label="Bucket">
        <Select name="bucketId" defaultValue="">
          <option value="">— none —</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Labeled>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add milestone"}
      </Button>
      <div className="w-full">
        <Errors errors={state.errors} />
      </div>
    </form>
  );
}

function MilestoneRowView({ m, buckets }: { m: MilestoneRow; buckets: BucketOpt[] }) {
  const { editing, toggle, errors, pending, onSubmit, runVoid } = useEditorForm(updateMilestone);
  const bucketName = buckets.find((b) => b.id === m.bucketId)?.name;
  const pct = m.totalTasks > 0 ? Math.round((m.doneTasks / m.totalTasks) * 100) : null;

  return (
    <li className="border-b border-rule py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className={m.completedAt ? "text-sm text-ink-muted line-through" : "text-sm text-ink"}>
            {m.name}
          </span>
          <span className="tabular ml-2 text-xs text-ink-muted">
            {[
              m.targetDate,
              bucketName,
              m.totalTasks > 0 ? `${m.doneTasks}/${m.totalTasks} tasks${pct !== null ? ` · ${pct}%` : ""}` : "no tasks linked",
              m.archived ? "archived" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(); fd.set("id", m.id); fd.set("completed", m.completedAt ? "false" : "true"); runVoid(() => updateMilestone(fd)); }}>
          <Button type="submit" variant="quiet" className="px-2 py-1 text-xs" disabled={pending}>
            {m.completedAt ? "Reopen" : "Mark reached"}
          </Button>
        </form>
        <Button type="button" variant="quiet" className="px-2 py-1 text-xs" onClick={toggle}>
          {editing ? "Close" : "Edit"}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="px-2 py-1 text-xs"
          onClick={() => {
            if (!confirm(`Delete the milestone "${m.name}"? Linked tasks are kept.`)) return;
            const fd = new FormData();
            fd.set("id", m.id);
            runVoid(() => deleteMilestone(fd));
          }}
        >
          Delete
        </Button>
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-2 flex flex-wrap items-end gap-2 border-t border-rule pt-2">
          <input type="hidden" name="id" value={m.id} />
          <Labeled label="Name">
            <Input name="name" defaultValue={m.name} required className="w-56" />
          </Labeled>
          <Labeled label="Target date">
            <Input name="targetDate" type="date" defaultValue={m.targetDate} className="w-40" />
          </Labeled>
          <Labeled label="Bucket">
            <Select name="bucketId" defaultValue={m.bucketId ?? ""}>
              <option value="">— none —</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Labeled>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="archived" value="true" defaultChecked={m.archived} />
            archived
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <div className="w-full">
            <Errors errors={errors} />
          </div>
        </form>
      ) : null}
    </li>
  );
}

export function MilestonesPanel({
  milestones,
  buckets,
}: {
  milestones: MilestoneRow[];
  buckets: BucketOpt[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <AddMilestone buckets={buckets} />
      {milestones.length > 0 ? (
        <ul className="border-t border-rule">
          {milestones.map((m) => (
            <MilestoneRowView key={m.id} m={m} buckets={buckets} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-rule py-4 text-sm text-ink-muted">
          No milestones. A milestone is a name, a date and a bucket — progress is
          counted from the tasks you link to it, nothing more.
        </p>
      )}
    </div>
  );
}
