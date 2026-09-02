"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { overrideFocusHour } from "@/app/(app)/review/actions";
import { MIN_FOCUS_SAMPLES, FOCUS_PREFER_THRESHOLD } from "@/lib/focus";

export type FocusRow = {
  hour: number;
  score: number | null;
  meanRatio: number | null;
  skipRate: number;
  sampleN: number;
  confident: boolean;
  manualScore: number | null;
};

const hm = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * The evidence behind the learned focus hours, hour by hour, with sample
 * counts — so the preference can be inspected rather than trusted, and
 * corrected when the data is clearly wrong.
 */
export function FocusHours({ rows }: { rows: FocusRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openHour, setOpenHour] = useState<number | null>(null);

  const withData = rows.filter((r) => r.sampleN > 0 || r.manualScore != null);

  if (withData.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing learned yet. Focus hours are derived from deep-work blocks on
        debriefed days — how close they land to their estimate, and how often
        they get skipped. Until an hour has {MIN_FOCUS_SAMPLES} samples it is not
        used, and the planner is told it does not know your focus hours rather
        than assuming a morning.
      </p>
    );
  }

  function set(hour: number, score: number | null) {
    const fd = new FormData();
    fd.set("hour", String(hour));
    fd.set("score", score == null ? "" : String(score));
    start(async () => {
      await overrideFocusHour(fd);
      setOpenHour(null);
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col">
      {withData.map((r) => {
        const effective = r.manualScore ?? r.score;
        const preferred = effective != null && effective >= FOCUS_PREFER_THRESHOLD;
        return (
          <li key={r.hour} className="border-b border-rule py-1.5 last:border-b-0">
            <div className="flex items-center gap-3">
              <span className="tabular w-12 shrink-0 text-xs text-ink-muted">
                {hm(r.hour)}
              </span>

              <div className="h-2 min-w-0 flex-1 border border-rule bg-paper" style={{ borderRadius: "var(--radius)" }}>
                <div
                  className="h-full"
                  style={{
                    width: `${Math.round((effective ?? 0) * 100)}%`,
                    background: preferred ? "var(--color-settled)" : "var(--color-ink-muted)",
                  }}
                />
              </div>

              <span className="tabular shrink-0 text-xs text-ink-muted">
                {effective == null
                  ? `${r.sampleN}/${MIN_FOCUS_SAMPLES} samples`
                  : `${effective.toFixed(2)}${r.manualScore != null ? " (yours)" : ""}`}
              </span>

              <button
                type="button"
                onClick={() => setOpenHour(openHour === r.hour ? null : r.hour)}
                className="shrink-0 text-xs text-ink-muted hover:text-ink"
              >
                {openHour === r.hour ? "close" : "override"}
              </button>
            </div>

            <p className="tabular mt-0.5 pl-12 text-[11px] text-ink-muted">
              {r.sampleN} sample{r.sampleN === 1 ? "" : "s"}
              {r.meanRatio != null ? ` · runs ${r.meanRatio}× estimate` : " · no completions"}
              {r.skipRate > 0 ? ` · skipped ${Math.round(r.skipRate * 100)}%` : ""}
              {!r.confident && r.manualScore == null ? " · not used yet" : ""}
            </p>

            {openHour === r.hour ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-12">
                {[0, 0.3, 0.6, 0.9].map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={pending}
                    onClick={() => set(r.hour, v)}
                    className={cn(
                      "border border-rule px-2 py-1 text-[11px] disabled:opacity-50",
                      r.manualScore === v ? "bg-ink text-paper" : "bg-surface text-ink-muted hover:text-ink",
                    )}
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    {v === 0 ? "never" : v === 0.3 ? "poor" : v === 0.6 ? "ok" : "good"}
                  </button>
                ))}
                {r.manualScore != null ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => set(r.hour, null)}
                    className="px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
                  >
                    use the data instead
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
