"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createBucket,
  saveBucketTarget,
  updateBucket,
  setBucketActive,
  type FormResult,
} from "@/app/(app)/settings/actions";
import { Button, Input, Labeled } from "@/components/ui/controls";
import { useEditorForm } from "@/components/ui/use-editor-form";

const INITIAL: FormResult = { ok: true, errors: [] };

type Bucket = {
  id: string;
  name: string;
  color: string;
  priorityHint: string | null;
  weeklyTargetMin: number | null;
  active: boolean;
};

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

function AddBucket() {
  const [state, action, pending] = useActionState(createBucket, INITIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state !== INITIAL) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Labeled label="New bucket" hint="lowercase; letters, numbers, - _ space">
        <Input name="name" placeholder="e.g. studio" required />
      </Labeled>
      <Labeled label="Colour">
        <Input name="color" type="color" defaultValue="#2f5d50" className="h-9 w-14 p-1" />
      </Labeled>
      <Labeled label="Priority hint">
        <Input name="priorityHint" placeholder="e.g. weekday priority" className="w-48" />
      </Labeled>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add bucket"}
      </Button>
      <div className="w-full">
        <Errors errors={state.errors} />
      </div>
    </form>
  );
}

function BucketRow({ bucket }: { bucket: Bucket }) {
  const { editing, toggle, errors, pending, onSubmit } = useEditorForm(updateBucket);

  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 shrink-0 border border-line"
          style={{ backgroundColor: bucket.color, borderRadius: "2px" }}
        />
        <div className="min-w-0 flex-1">
          <span className="text-sm text-ink">{bucket.name}</span>
          {bucket.priorityHint ? (
            <span className="ml-2 text-xs text-ink-muted">{bucket.priorityHint}</span>
          ) : null}
          {bucket.weeklyTargetMin ? (
            <span className="tabular ml-2 text-xs text-ink-muted">
              · {(bucket.weeklyTargetMin / 60).toFixed(1)}h/wk target
            </span>
          ) : null}
          {!bucket.active ? (
            <span className="ml-2 text-xs text-ink-muted">· retired</span>
          ) : null}
        </div>

        <form action={setBucketActive}>
          <input type="hidden" name="id" value={bucket.id} />
          <input type="hidden" name="active" value={(!bucket.active).toString()} />
          <Button type="submit" variant="quiet" className="px-2 py-1 text-xs">
            {bucket.active ? "Retire" : "Reactivate"}
          </Button>
        </form>
        <Button
          type="button"
          variant="quiet"
          className="px-2 py-1 text-xs"
          onClick={toggle}
        >
          {editing ? "Close" : "Edit"}
        </Button>
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
          <input type="hidden" name="id" value={bucket.id} />
          <Labeled label="Name">
            <Input name="name" defaultValue={bucket.name} required />
          </Labeled>
          <Labeled label="Colour">
            <Input
              name="color"
              type="color"
              defaultValue={bucket.color}
              className="h-9 w-14 p-1"
            />
          </Labeled>
          <Labeled label="Priority hint">
            <Input
              name="priorityHint"
              defaultValue={bucket.priorityHint ?? ""}
              className="w-48"
            />
          </Labeled>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <div className="w-full">
            <Errors errors={errors} />
          </div>
        </form>
      ) : null}

      {editing ? (
        <form
          action={saveBucketTarget}
          className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        >
          <input type="hidden" name="bucketId" value={bucket.id} />
          <Labeled
            label="Weekly target (hours)"
            hint="Intent only — nothing schedules against it. Blank to clear."
          >
            <Input
              name="targetHours"
              type="number"
              min={0}
              max={168}
              step={0.5}
              defaultValue={
                bucket.weeklyTargetMin != null ? bucket.weeklyTargetMin / 60 : ""
              }
              className="w-28"
            />
          </Labeled>
          <Button type="submit" variant="quiet">
            Save target
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export function BucketsPanel({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="flex flex-col gap-3">
      <AddBucket />
      {buckets.length > 0 ? (
        <ul className="border-t border-line">
          {buckets.map((b) => (
            <BucketRow key={b.id} bucket={b} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-line py-4 text-sm text-ink-muted">
          No buckets yet. Add one above — they are yours to name.
        </p>
      )}
    </div>
  );
}
