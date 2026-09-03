"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createHabit,
  updateHabit,
  deleteHabit,
  type FormResult,
} from "@/app/(app)/settings/actions";
import { Button, Input, Labeled, Select } from "@/components/ui/controls";
import { useEditorForm } from "@/components/ui/use-editor-form";
import { CadencePicker } from "@/components/settings/cadence-picker";
import { formatCadence, type HabitCadence } from "@/lib/habits";

const INITIAL: FormResult = { ok: true, errors: [] };

type Habit = {
  id: string;
  name: string;
  cadence: HabitCadence;
  durationMin: number;
  preferredWindow: string | null;
  bucketId: string | null;
  active: boolean;
};
type BucketOpt = { id: string; name: string };

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="mt-1 list-disc pl-5 text-xs text-warn">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

function AddHabit({ buckets }: { buckets: BucketOpt[] }) {
  const [state, action, pending] = useActionState(createHabit, INITIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state !== INITIAL) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Labeled label="New habit">
        <Input name="name" placeholder="e.g. gym" required />
      </Labeled>
      <CadencePicker />
      <Labeled label="Duration (min)">
        <Input name="durationMin" type="number" min={5} max={480} step={5} required className="w-24" />
      </Labeled>
      <Labeled label="Preferred window">
        <Input name="preferredWindow" placeholder="06:00-08:00 or evening" className="w-44" />
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
        {pending ? "Adding…" : "Add habit"}
      </Button>
      <div className="w-full">
        <Errors errors={state.errors} />
      </div>
    </form>
  );
}

function HabitRow({ habit, buckets }: { habit: Habit; buckets: BucketOpt[] }) {
  const { editing, toggle, errors, pending, onSubmit, runVoid } =
    useEditorForm(updateHabit);

  const bucketName = buckets.find((b) => b.id === habit.bucketId)?.name;
  const meta = [
    formatCadence(habit.cadence),
    `${habit.durationMin}m`,
    habit.preferredWindow,
    bucketName,
    habit.active ? null : "inactive",
  ].filter(Boolean);

  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-sm text-ink">{habit.name}</span>
          <span className="tabular ml-2 text-xs text-ink-muted">{meta.join(" · ")}</span>
        </div>
        <Button
          type="button"
          variant="quiet"
          className="px-2 py-1 text-xs"
          onClick={toggle}
        >
          {editing ? "Close" : "Edit"}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="px-2 py-1 text-xs"
          onClick={() => {
            if (!confirm(`Delete the habit "${habit.name}"?`)) return;
            const fd = new FormData();
            fd.set("id", habit.id);
            runVoid(() => deleteHabit(fd));
          }}
        >
          Delete
        </Button>
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
          <input type="hidden" name="id" value={habit.id} />
          <Labeled label="Name">
            <Input name="name" defaultValue={habit.name} required />
          </Labeled>
          <CadencePicker initial={habit.cadence} />
          <Labeled label="Duration (min)">
            <Input
              name="durationMin"
              type="number"
              min={5}
              max={480}
              step={5}
              defaultValue={habit.durationMin}
              className="w-24"
            />
          </Labeled>
          <Labeled label="Preferred window">
            <Input
              name="preferredWindow"
              defaultValue={habit.preferredWindow ?? ""}
              className="w-44"
            />
          </Labeled>
          <Labeled label="Bucket">
            <Select name="bucketId" defaultValue={habit.bucketId ?? ""}>
              <option value="">— none —</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Labeled>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              name="active"
              value="true"
              defaultChecked={habit.active}
            />
            active
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

export function HabitsPanel({
  habits,
  buckets,
}: {
  habits: Habit[];
  buckets: BucketOpt[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <AddHabit buckets={buckets} />
      {habits.length > 0 ? (
        <ul className="border-t border-line">
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h} buckets={buckets} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-line py-4 text-sm text-ink-muted">
          No habits yet. These are recurring things you want placed — gym,
          reading, a weekly call.
        </p>
      )}
    </div>
  );
}
