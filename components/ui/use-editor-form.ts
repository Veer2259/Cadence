"use client";

import { useState, useTransition } from "react";

type Result = { ok: boolean; errors: string[] };

/**
 * Drives an inline "expand to edit" form backed by a Server Action of shape
 * `(FormData) => Promise<Result>`. Collapses on success, shows errors on failure.
 * Uses a transition rather than an effect so there is no setState-in-effect.
 */
export function useEditorForm(action: (fd: FormData) => Promise<Result>) {
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    startTransition(async () => {
      const res = await action(fd);
      if (res.ok) {
        setErrors([]);
        setEditing(false);
      } else {
        setErrors(res.errors);
      }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit(new FormData(e.currentTarget));
  }

  function toggle() {
    setErrors([]);
    setEditing((v) => !v);
  }

  /** Fire-and-forget a void action (e.g. delete) inside the same transition. */
  function runVoid(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
    });
  }

  return { editing, toggle, errors, pending, onSubmit, submit, runVoid };
}
