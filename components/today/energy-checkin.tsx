"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { logEnergy } from "@/app/(app)/today/actions";
import type { EnergyLevel } from "@/lib/energy";

const OPTIONS: { key: EnergyLevel; label: string }[] = [
  { key: "fried", label: "fried" },
  { key: "ok", label: "ok" },
  { key: "sharp", label: "sharp" },
];

function hm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * One tap, stamped with the time. This is the raw material for the sharp-hours
 * suggestion in Settings — a day's worth of single values could never tell you
 * WHICH hours you think clearly in.
 */
export function EnergyCheckin({
  latest,
}: {
  latest: { level: EnergyLevel; minuteOfDay: number } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [justSaved, setJustSaved] = useState<EnergyLevel | null>(null);

  function pick(level: EnergyLevel) {
    start(async () => {
      const res = await logEnergy(level);
      if (res.ok) {
        setJustSaved(level);
        router.refresh();
      }
    });
  }

  const current = justSaved ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">Energy now</span>
      <div className="flex" role="group" aria-label="Record your energy right now">
        {OPTIONS.map((o, i) => (
          <button
            key={o.key}
            type="button"
            disabled={pending}
            aria-pressed={current === o.key}
            onClick={() => pick(o.key)}
            className={cn(
              "border border-rule px-2 py-1 text-xs disabled:opacity-60",
              i === 0 ? "" : "-ml-px",
              current === o.key
                ? "bg-ink text-paper"
                : "bg-surface text-ink-muted hover:text-ink",
            )}
            style={{
              borderTopLeftRadius: i === 0 ? "var(--radius)" : 0,
              borderBottomLeftRadius: i === 0 ? "var(--radius)" : 0,
              borderTopRightRadius: i === OPTIONS.length - 1 ? "var(--radius)" : 0,
              borderBottomRightRadius: i === OPTIONS.length - 1 ? "var(--radius)" : 0,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {justSaved ? (
        <span className="text-xs text-settled">logged</span>
      ) : latest ? (
        <span className="text-xs text-ink-muted">
          last: {latest.level} at {hm(latest.minuteOfDay)}
        </span>
      ) : (
        <span className="text-xs text-ink-muted">not logged today</span>
      )}
    </div>
  );
}
