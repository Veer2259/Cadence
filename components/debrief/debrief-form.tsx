"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/controls";
import { StarMark } from "@/components/more/streak-banner";
import {
  submitDebriefAction,
  type DebriefActionResult,
} from "@/app/(app)/debrief/actions";
import { describeThrown } from "@/lib/thrown";

export type DebriefBlock = {
  id: string;
  title: string;
  kind: "task" | "fixed" | "habit" | "break";
  category: string;
  plannedMin: number;
  startLabel: string;
  /** what was already logged from the ribbon during the day, if anything */
  loggedStatus: "done" | "partial" | "skipped" | null;
  loggedActualMin: number | null;
};

type Status = "done" | "partial" | "skipped";
type Row = { status: Status; actualMin: number };

const STATUSES: { key: Status; label: string }[] = [
  { key: "done", label: "Done" },
  { key: "partial", label: "Partial" },
  { key: "skipped", label: "Skipped" },
];

function dur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${String(m).padStart(2, "0")}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function DebriefForm({
  planId,
  dateLabel,
  blocks,
  streakAfter,
}: {
  planId: string;
  dateLabel: string;
  blocks: DebriefBlock[];
  /** The run INCLUDING today, for the reward. See the debrief page. */
  streakAfter: number;
}) {
  // Seed from whatever was logged live; only the untouched blocks fall back to
  // the "done, as planned" default. Nothing already answered is asked again.
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      blocks.map((b) => [
        b.id,
        {
          status: (b.loggedStatus ?? "done") as Status,
          actualMin: b.loggedActualMin ?? b.plannedMin,
        },
      ]),
    ),
  );
  const preLogged = blocks.filter((b) => b.loggedStatus !== null).length;
  const remaining = blocks.length - preLogged;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DebriefActionResult | null>(null);

  const changed = useMemo(
    () =>
      blocks.filter((b) => {
        const r = rows[b.id];
        return r.status !== "done" || r.actualMin !== b.plannedMin;
      }).length,
    [rows, blocks],
  );

  function setRow(id: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function submit() {
    start(async () => {
      const entries = blocks.map((b) => {
        const r = rows[b.id];
        return {
          blockId: b.id,
          status: r.status,
          actualMin: r.status === "skipped" ? null : r.actualMin,
        };
      });
      try {
        setResult(await submitDebriefAction({ planId, entries }));
      } catch (e) {
        // A thrown failure used to leave the button pending with nothing shown.
        setResult({ ok: false, error: describeThrown(e) });
      }
    });
  }

  if (result?.ok) {
    const over = result.loggedMin - result.plannedMin;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: "rgba(42,36,25,.42)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Day closed"
      >
        <div className="animate-pop w-full max-w-sm rounded-[28px] bg-surface p-6 text-center">
          <div className="relative mx-auto h-[110px] w-[110px]">
            <svg width="110" height="110" viewBox="0 0 110 110" aria-hidden>
              <circle
                cx="55"
                cy="55"
                r="48"
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="9"
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-primary">
              <StarMark size={40} />
            </span>
          </div>

          <h1 className="mt-4 text-[24px] font-extrabold tracking-[-0.03em] text-ink">
            Day closed
          </h1>
          <p className="mt-1 text-[15px] font-extrabold text-primary">
            {streakAfter} day{streakAfter === 1 ? "" : "s"} in a row
          </p>

          <p className="mt-3 text-[13.5px] leading-[1.5] font-medium text-ink-muted">
            {dur(result.loggedMin)} logged against {dur(result.plannedMin)} planned
            {over === 0
              ? " — exactly as estimated."
              : over > 0
                ? ` — ${dur(over)} over.`
                : ` — ${dur(-over)} under.`}
          </p>
          <p className="mt-2 text-[13.5px] leading-[1.5] font-medium text-ink-soft">
            {result.summary}
          </p>

          <Link href="/today" className="mt-5 block">
            <span className="flex min-h-[50px] w-full items-center justify-center rounded-full bg-ink text-sm font-extrabold text-paper">
              Nice. Onward.
            </span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">Debrief — {dateLabel}</h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          {preLogged > 0
            ? remaining > 0
              ? `${preLogged} of ${blocks.length} already logged during the day — change only the remaining ${remaining}, then log the day.`
              : "Everything was already logged during the day. Check it over, then log the day."
            : "Everything is marked done at the planned time. Change only what was different, then log the day."}
        </p>
      </div>

      <ul className="flex flex-col gap-2.5">
        {blocks.map((b) => {
          const r = rows[b.id];
          const skipped = r.status === "skipped";
          return (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[18px] bg-surface p-3.5 shadow-card"
            >
              <div className="min-w-[9rem] flex-1">
                <p className={cn("text-[14.5px] font-bold", skipped ? "text-ink-ghost line-through" : "text-ink")}>
                  {b.title}
                </p>
                <p className="tabular text-xs text-ink-muted">
                  {b.startLabel} · {dur(b.plannedMin)} planned
                  {b.kind !== "task" ? ` · ${b.kind}` : ""}
                </p>
              </div>

              <div className="flex gap-1.5" role="group" aria-label={`Status for ${b.title}`}>
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={r.status === s.key}
                    onClick={() => setRow(b.id, { status: s.key })}
                    className={cn(
                      "min-h-[34px] rounded-full px-3 text-[12px] font-extrabold",
                      r.status !== s.key
                        ? "bg-tint text-ink-soft"
                        : s.key === "done"
                          ? "bg-primary text-white"
                          : s.key === "partial"
                            ? "bg-caution text-white"
                            : "bg-warn text-white",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div
                className={cn(
                  "flex items-center",
                  skipped && "pointer-events-none opacity-40",
                )}
              >
                <button
                  type="button"
                  aria-label="5 minutes less"
                  onClick={() => setRow(b.id, { actualMin: Math.max(0, r.actualMin - 5) })}
                  className="h-[42px] w-[38px] rounded-l-full bg-tint text-ink-soft"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  step={5}
                  value={r.actualMin}
                  onChange={(e) =>
                    setRow(b.id, {
                      actualMin: Math.max(0, Math.min(1440, Number(e.target.value) || 0)),
                    })
                  }
                  className="tabular h-[42px] w-[66px] bg-tint text-center text-sm font-extrabold text-ink outline-none"
                  aria-label={`Actual minutes for ${b.title}`}
                />
                <button
                  type="button"
                  aria-label="5 minutes more"
                  onClick={() => setRow(b.id, { actualMin: Math.min(1440, r.actualMin + 5) })}
                  className="h-[42px] w-[38px] rounded-r-full bg-tint text-ink-soft"
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {result && !result.ok ? (
        <p role="alert" className="text-[13px] font-semibold text-warn">
          {result.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending} className="px-5 py-2.5">
          {pending ? "Logging the day…" : "Log the day"}
        </Button>
        <span className="text-xs text-ink-muted">
          {changed === 0 ? "nothing changed" : `${changed} change${changed === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}
