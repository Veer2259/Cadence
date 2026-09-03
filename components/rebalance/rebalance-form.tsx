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
  leftMin,
  lockedCount,
}: {
  remaining: { title: string; startLabel: string; status: string }[];
  /** Minutes left in the working day, for the LEFT tile. */
  leftMin: number;
  /** Blocks already done or partial — they are carried through untouched. */
  lockedCount: number;
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

  const hrs = (m: number) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h && r) return `${h}h ${r}m`;
    if (h) return `${h}h`;
    return `${r}m`;
  };

  return (
    <div className="animate-rise-in flex flex-col gap-3">
      <div>
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Rebalance
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] font-medium text-ink-muted">
          Blocks you have already marked done or partial stay exactly where they
          are. Only the rest of the day gets replanned.
        </p>
      </div>

      <div className="flex gap-2.5">
        <div className="flex-1 rounded-2xl bg-tint px-3 py-2.5">
          <p className="text-[10px] font-bold tracking-[0.1em] text-ink-soft uppercase">
            Left
          </p>
          <p className="tabular mt-0.5 text-[16px] font-extrabold text-ink">
            {hrs(Math.max(0, leftMin))}
          </p>
        </div>
        <div className="flex-1 rounded-2xl bg-tint px-3 py-2.5">
          <p className="text-[10px] font-bold tracking-[0.1em] text-ink-soft uppercase">
            To place
          </p>
          <p className="tabular mt-0.5 text-[16px] font-extrabold text-ink">
            {remaining.length}
          </p>
        </div>
        <div className="flex-1 rounded-2xl bg-primary-tint px-3 py-2.5">
          <p className="text-[10px] font-bold tracking-[0.1em] text-primary-deep uppercase">
            Locked
          </p>
          <p className="tabular mt-0.5 text-[16px] font-extrabold text-primary-deep">
            {lockedCount} done
          </p>
        </div>
      </div>

      <label className="mt-1 flex flex-col gap-1.5">
        <span className="text-[12px] font-bold text-ink-soft">What changed?</span>
        <Textarea
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="e.g. the morning call ran long, skipped the gym, feeling scattered"
          className="min-h-[5rem] w-full"
        />
      </label>

      <div>
        <span className="text-[12px] font-bold text-ink-soft">Energy</span>
        <div className="mt-1.5 flex gap-2">
          {ENERGY.map((e) => (
            <button
              key={e.key}
              type="button"
              aria-pressed={energy === e.key}
              onClick={() => setEnergy(e.key)}
              className={cn(
                "min-h-[38px] flex-1 rounded-full text-[13px] font-extrabold",
                energy === e.key ? "bg-ink text-paper" : "bg-tint text-ink-soft",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        {energy === "fried" ? (
          <p className="mt-1.5 text-[11.5px] font-semibold text-ink-faint">
            No deep work will be scheduled.
          </p>
        ) : null}
      </div>

      {remaining.length > 0 ? (
        <div className="rounded-[18px] bg-surface p-3.5 shadow-card">
          <p className="mb-1.5 text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
            Still on the board ({remaining.length})
          </p>
          <ul className="flex flex-col gap-1">
            {remaining.map((r, i) => (
              <li key={i} className="flex items-baseline gap-2.5">
                <span className="tabular w-11 shrink-0 text-[12px] font-bold text-ink-faint">
                  {r.startLabel}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                  {r.title}
                  {r.status === "skipped" ? " (skipped)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-[18px] bg-surface px-4 py-5 text-[13.5px] font-medium text-ink-muted shadow-card">
          Every block is already done — nothing to replan.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-warn">
          {error}
        </p>
      ) : null}
      {warnings.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">
            Saved with checks still failing:
          </p>
          <ul className="list-disc pl-4 text-[12.5px] font-medium text-ink-muted">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button onClick={submit} disabled={pending} size="lg" className="mt-1 w-full">
        {pending ? "Replanning the rest of the day…" : "Rebalance the rest of the day"}
      </Button>
      <p className="text-center text-[11.5px] font-semibold text-ink-faint">
        This produces a draft. Nothing is committed until you say so on Today.
      </p>
    </div>
  );
}
