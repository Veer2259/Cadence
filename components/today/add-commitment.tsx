"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCommitment } from "@/app/(app)/today/actions";
import { Button, Input, Labeled } from "@/components/ui/controls";

/**
 * A one-line "something fixed came up today" form, tucked into the Today
 * heading. Writes a `commitments` row for today; the planner treats it as
 * absolute on the next compose / rebalance. Transition-driven (no effect).
 */
export function AddCommitment({ date }: { date?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (date) fd.set("date", date);
    start(async () => {
      const res = await addCommitment(fd);
      if (res.ok) {
        setErrors([]);
        setOpen(false);
        router.refresh();
      } else {
        setErrors(res.errors);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setErrors([]);
          setOpen(true);
        }}
        className="text-xs text-ink-muted hover:text-ink"
      >
        ＋ Fixed commitment
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2 rounded-[18px] bg-surface p-3 shadow-card"
      style={{ borderRadius: "var(--radius)" }}
    >
      <Labeled label="What">
        <Input name="title" placeholder="e.g. football" required className="w-40" />
      </Labeled>
      <Labeled label="From">
        <Input name="start" type="time" required className="w-28" />
      </Labeled>
      <Labeled label="To">
        <Input name="end" type="time" required className="w-28" />
      </Labeled>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
      {errors.length ? (
        <ul role="alert" className="w-full list-disc pl-5 text-xs text-warn">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
