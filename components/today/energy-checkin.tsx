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

  const current = justSaved ?? latest?.level ?? null;

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[12px] font-bold text-ink-soft">Feeling</span>
      <div className="flex gap-2" role="group" aria-label="Record your energy right now">
        {OPTIONS.map((o) => {
          const active = current === o.key;
          return (
            <button
              key={o.key}
              type="button"
              disabled={pending}
              aria-pressed={active}
              onClick={() => pick(o.key)}
              className={cn(
                "min-h-[34px] rounded-full px-3.5 text-[12.5px] font-bold capitalize disabled:opacity-60",
                active ? "bg-ink text-paper" : "bg-tint text-ink-soft",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {latest && !justSaved ? (
        <span className="tabular text-[11px] font-semibold text-ink-faint">
          {hm(latest.minuteOfDay)}
        </span>
      ) : null}
    </div>
  );
}
