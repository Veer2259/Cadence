"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = { error: null };

export function LoginForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(login, initial);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="from" value={from} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-muted">Passphrase</span>
        <input
          type="password"
          name="passphrase"
          autoFocus
          autoComplete="current-password"
          required
          className="border border-rule bg-surface px-3 py-2 text-ink outline-none focus:border-ink"
          style={{ borderRadius: "var(--radius)" }}
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-signal">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
        style={{ borderRadius: "var(--radius)" }}
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
