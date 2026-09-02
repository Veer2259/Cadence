"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/controls";
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
}: {
  planId: string;
  dateLabel: string;
  blocks: DebriefBlock[];
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
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-mono text-lg tracking-tight text-ink">Day closed — {dateLabel}</h1>
        <p className="judgment border-l-2 border-settled pl-3 text-sm text-ink">
          {result.summary}
        </p>
        <p className="tabular text-xs text-ink-muted">
          {dur(result.loggedMin)} logged of {dur(result.plannedMin)} planned ·{" "}
          {result.tasksDone} task{result.tasksDone === 1 ? "" : "s"} done ·{" "}
          {result.carriedOver} carried over ·{" "}
          {result.calibrationTouched.length} calibration key
          {result.calibrationTouched.length === 1 ? "" : "s"} updated
        </p>
        <div>
          <Link
            href="/today"
            className="inline-block bg-ink px-4 py-2 text-sm font-medium text-paper"
            style={{ borderRadius: "var(--radius)" }}
          >
            Back to today
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

      <ul className="border-t border-rule">
        {blocks.map((b) => {
          const r = rows[b.id];
          const skipped = r.status === "skipped";
          return (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule py-2"
            >
              <div className="min-w-[9rem] flex-1">
                <p className={cn("text-sm", skipped ? "text-ink-muted line-through" : "text-ink")}>
                  {b.title}
                </p>
                <p className="tabular text-xs text-ink-muted">
                  {b.startLabel} · {dur(b.plannedMin)} planned
                  {b.kind !== "task" ? ` · ${b.kind}` : ""}
                </p>
              </div>

              <div
                className="flex overflow-hidden border border-rule"
                style={{ borderRadius: "var(--radius)" }}
                role="group"
                aria-label={`Status for ${b.title}`}
              >
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={r.status === s.key}
                    onClick={() => setRow(b.id, { status: s.key })}
                    className={cn(
                      "px-3 py-2 text-xs font-medium",
                      r.status === s.key
                        ? "bg-ink text-paper"
                        : "bg-surface text-ink-muted hover:text-ink",
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
                  className="h-9 w-9 border border-rule text-ink-muted hover:text-ink"
                  style={{ borderRadius: "var(--radius) 0 0 var(--radius)" }}
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
                  className="tabular h-9 w-14 border-y border-rule bg-surface text-center text-sm text-ink outline-none focus:border-ink"
                  aria-label={`Actual minutes for ${b.title}`}
                />
                <button
                  type="button"
                  aria-label="5 minutes more"
                  onClick={() => setRow(b.id, { actualMin: Math.min(1440, r.actualMin + 5) })}
                  className="h-9 w-9 border border-rule text-ink-muted hover:text-ink"
                  style={{ borderRadius: "0 var(--radius) var(--radius) 0" }}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-signal">
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
