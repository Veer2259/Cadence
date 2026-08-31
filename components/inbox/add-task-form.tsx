"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTask, type FormResult } from "@/app/(app)/inbox/actions";
import { CATEGORIES, PRIORITIES } from "@/lib/schemas";
import { Button, Input, Labeled, Select } from "@/components/ui/controls";

const INITIAL: FormResult = { ok: true, errors: [] };

export function AddTaskForm({ buckets }: { buckets: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createTask, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.ok && state !== INITIAL) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="border border-rule bg-surface p-3"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Labeled label="New task">
            <Input name="title" placeholder="e.g. draft the sampling brief" required />
          </Labeled>
        </div>

        <Labeled label="Category">
          <Select name="category" defaultValue="shallow">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Labeled>

        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="py-1.5 text-xs text-ink-muted underline underline-offset-2"
        >
          {open ? "fewer details" : "more details"}
        </button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-wrap gap-3 border-t border-rule pt-3">
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

          <Labeled label="Priority">
            <Select name="priority" defaultValue="normal">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Labeled>

          <Labeled label="Estimate (min)">
            <Input name="estimateMin" type="number" min={5} max={1440} step={5} className="w-28" />
          </Labeled>

          <Labeled label="Due">
            <Input name="dueDate" type="date" className="w-40" />
          </Labeled>

          <label className="flex items-end gap-1.5 pb-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="hold" value="on" />
            hold for review first (don&rsquo;t make it plannable yet)
          </label>
        </div>
      ) : null}

      {state.errors.length > 0 ? (
        <ul role="alert" className="mt-2 list-disc pl-5 text-xs text-signal">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
