"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = { error: null };

export function LoginForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(login, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="from" value={from} />

      <label className="flex flex-col gap-1.5">
        <span className="sr-only">Passphrase</span>
        <input
          type="password"
          name="passphrase"
          autoFocus
          autoComplete="current-password"
          required
          placeholder="Passphrase"
          className="min-h-[52px] rounded-full bg-tint px-5 text-center text-[15px] font-semibold text-ink placeholder:text-ink-faint outline-none focus:bg-surface focus:ring-2 focus:ring-primary/40"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-center text-[13px] font-semibold text-warn">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[52px] rounded-full bg-primary text-[15px] font-extrabold text-white disabled:opacity-60"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>

      <p className="mt-1 text-center text-[11.5px] font-semibold text-ink-faint">
        Stays unlocked on this device for 30 days.
      </p>
    </form>
  );
}
