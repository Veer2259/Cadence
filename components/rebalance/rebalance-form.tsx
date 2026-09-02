"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button, Textarea } from "@/components/ui/controls";
import { rebalanceAction } from "@/app/(app)/rebalance/actions";
import { describeThrown } from "@/lib/thrown";

const ENERGY = [
  { key: "sharp", label: "Sharp" },
  { key: "ok", label: "OK" },
  { key: "fried", label: "Fried" },
] as const;

export function RebalanceForm({
  remaining,
}: {
  remaining: { title: string; startLabel: string; status: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [account, setAccount] = useState("");
  const [energy, setEnergy] = useState<"sharp" | "ok" | "fried">("ok");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function submit() {
    setError(null);
    setWarnings([]);
    start(async () => {
      // The action RETURNS its expected failures (quota, rate limit, budget).
      // A thrown one — a function timeout, a dropped connection, a 500 from the
      // Server Action endpoint — used to reject unhandled, leaving the button
      // stuck on "Replanning…" with nothing on screen. Silence is the worst
      // possible report.
      let res;
      try {
        res = await rebalanceAction({ account, energy });
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.violations.length) {
        setWarnings(res.violations);
        // still navigate — the draft is saved with the violations flagged
      }
      router.push("/today");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">Rebalance</h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          Blocks you have already marked done or partial stay exactly where they
          are. Only the rest of the day gets replanned.
        </p>
      </div>

      {remaining.length > 0 ? (
        <div className="border border-rule bg-surface p-3 text-sm" style={{ borderRadius: "var(--radius)" }}>
          <p className="mb-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
            Still open ({remaining.length})
          </p>
          <ul className="tabular text-xs text-ink-muted">
            {remaining.map((r, i) => (
              <li key={i}>
                {r.startLabel} · {r.title}
                {r.status === "skipped" ? " (skipped)" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Every block is already done — nothing to replan.</p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">What happened?</span>
        <Textarea
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="e.g. the morning call ran long, skipped the gym, feeling scattered"
          className="min-h-[4rem] w-full"
        />
      </label>

      <div>
        <span className="text-xs text-ink-muted">Energy</span>
        <div
          className="mt-1 flex w-max overflow-hidden border border-rule"
          style={{ borderRadius: "var(--radius)" }}
        >
          {ENERGY.map((e) => (
            <button
              key={e.key}
              type="button"
              aria-pressed={energy === e.key}
              onClick={() => setEnergy(e.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium",
                energy === e.key ? "bg-ink text-paper" : "bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        {energy === "fried" ? (
          <p className="mt-1 text-xs text-ink-muted">No deep work will be scheduled.</p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      ) : null}
      {warnings.length ? (
        <div className="border border-caution/50 bg-surface p-3 text-xs" style={{ borderRadius: "var(--radius)" }}>
          <p className="mb-1 font-medium text-caution">Saved with checks still failing:</p>
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <Button onClick={submit} disabled={pending} className="px-5 py-2.5">
          {pending ? "Replanning the rest of the day…" : "Rebalance"}
        </Button>
      </div>
    </div>
  );
}
