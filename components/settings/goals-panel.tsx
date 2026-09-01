"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveBucketGoal,
  createWeeklyTarget,
  updateWeeklyTarget,
  deleteWeeklyTarget,
  type FormResult,
} from "@/app/(app)/settings/actions";
import { Button, Input, Labeled, Select, Textarea } from "@/components/ui/controls";
import { useEditorForm } from "@/components/ui/use-editor-form";

const INITIAL: FormResult = { ok: true, errors: [] };

export type GoalBucket = {
  id: string;
  name: string;
  outcome: string | null;
  outcomeTargetDate: string | null;
  status: "active" | "achieved" | "abandoned";
  weeksLeft: number | null;
};

export type TargetRow = {
  id: string;
  bucketId: string;
  bucketName: string;
  weekStart: string;
  description: string;
  targetHours: number | null;
  status: string;
  totalTasks: number;
  doneTasks: number;
  actualHours: number;
};

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

function BucketGoalRow({ b }: { b: GoalBucket }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-rule py-2 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-sm text-ink">{b.name}</span>
          <span className="ml-2 text-xs text-ink-muted">
            {b.status !== "active" ? b.status + " · " : ""}
            {b.outcome ? b.outcome : "no outcome set"}
          </span>
          {b.outcomeTargetDate ? (
            <span className="tabular ml-2 text-xs text-ink-muted">
              by {b.outcomeTargetDate}
              {b.weeksLeft !== null
                ? b.weeksLeft < 0
                  ? " · " + Math.abs(b.weeksLeft) + "w past"
                  : " · " + b.weeksLeft + "w left"
                : ""}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="quiet"
          className="px-2 py-1 text-xs"
          onClick={() => setOpen(!open)}
        >
          {open ? "Close" : "Edit goal"}
        </Button>
      </div>

      {open ? (
        <form
          action={saveBucketGoal}
          className="mt-2 flex flex-wrap items-end gap-2 border-t border-rule pt-2"
        >
          <input type="hidden" name="bucketId" value={b.id} />
          <Labeled label="Outcome — what done looks like, one sentence">
            <Textarea
              name="outcome"
              defaultValue={b.outcome ?? ""}
              className="min-h-[3rem] w-80"
            />
          </Labeled>
          <Labeled label="Target date">
            <Input
              name="outcomeTargetDate"
              type="date"
              defaultValue={b.outcomeTargetDate ?? ""}
              className="w-40"
            />
          </Labeled>
          <Labeled label="Status">
            <Select name="status" defaultValue={b.status}>
              <option value="active">active</option>
              <option value="achieved">achieved</option>
              <option value="abandoned">abandoned</option>
            </Select>
          </Labeled>
          <Button type="submit">Save goal</Button>
        </form>
      ) : null}
    </li>
  );
}

function TargetRowView({ t }: { t: TargetRow }) {
  const { editing, toggle, errors, pending, onSubmit, runVoid } =
    useEditorForm(updateWeeklyTarget);

  const meta = [
    t.bucketName,
    t.targetHours != null
      ? t.actualHours + "h / " + t.targetHours + "h"
      : t.actualHours + "h logged",
    t.totalTasks > 0 ? t.doneTasks + "/" + t.totalTasks + " tasks" : "no tasks linked",
    t.status !== "planned" ? t.status : null,
  ].filter(Boolean);

  return (
    <li className="border-b border-rule py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-sm text-ink">{t.description}</span>
          <span className="tabular ml-2 text-xs text-ink-muted">{meta.join(" · ")}</span>
        </div>
        <Button type="button" variant="quiet" className="px-2 py-1 text-xs" onClick={toggle}>
          {editing ? "Close" : "Edit"}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="px-2 py-1 text-xs"
          onClick={() => {
            if (!confirm("Delete this target? Linked tasks are kept.")) return;
            const fd = new FormData();
            fd.set("id", t.id);
            runVoid(() => deleteWeeklyTarget(fd));
          }}
        >
          Delete
        </Button>
      </div>

      {editing ? (
        <form
          onSubmit={onSubmit}
          className="mt-2 flex flex-wrap items-end gap-2 border-t border-rule pt-2"
        >
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="bucketId" value={t.bucketId} />
          <input type="hidden" name="weekStart" value={t.weekStart} />
          <Labeled label="Description">
            <Input
              name="description"
              defaultValue={t.description}
              className="w-72"
              required
            />
          </Labeled>
          <Labeled label="Target hours" hint="optional">
            <Input
              name="targetHours"
              type="number"
              min={0}
              max={168}
              step={0.5}
              defaultValue={t.targetHours ?? ""}
              className="w-24"
            />
          </Labeled>
          <Labeled label="Status">
            <Select name="status" defaultValue={t.status}>
              {["planned", "hit", "partial", "missed", "dropped"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Review note">
            <Input name="reviewNote" className="w-56" />
          </Labeled>
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

export function GoalsPanel({
  goalBuckets,
  targets,
  weekStart,
}: {
  goalBuckets: GoalBucket[];
  targets: TargetRow[];
  weekStart: string;
}) {
  const [state, action, pending] = useActionState(createWeeklyTarget, INITIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state !== INITIAL) ref.current?.reset();
  }, [state]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-muted uppercase">
          Outcomes
        </h3>
        <ul className="border-t border-rule">
          {goalBuckets.map((b) => (
            <BucketGoalRow key={b.id} b={b} />
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-muted uppercase">
          Targets for the week of {weekStart}
        </h3>
        <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="weekStart" value={weekStart} />
          <Labeled label="Bucket">
            <Select name="bucketId" required defaultValue="">
              <option value="" disabled>
                — pick —
              </option>
              {goalBuckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Target this week">
            <Input
              name="description"
              placeholder="e.g. first draft of chapter 2"
              required
              className="w-72"
            />
          </Labeled>
          <Labeled label="Hours" hint="optional">
            <Input
              name="targetHours"
              type="number"
              min={0}
              max={168}
              step={0.5}
              className="w-24"
            />
          </Labeled>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add target"}
          </Button>
          <div className="w-full">
            <Errors errors={state.errors} />
          </div>
        </form>

        {targets.length ? (
          <ul className="mt-3 border-t border-rule">
            {targets.map((t) => (
              <TargetRowView key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 border-t border-rule py-4 text-sm text-ink-muted">
            No targets for this week yet.
          </p>
        )}
      </div>
    </div>
  );
}
