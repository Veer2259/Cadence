"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui/controls";
import { runKickoff, confirmKickoff } from "@/app/(app)/goals/actions";

const CATEGORIES = ["deep", "shallow", "calls", "admin", "errand", "personal"] as const;

type Candidate = {
  title: string;
  weeklyTargetId: string;
  category: (typeof CATEGORIES)[number];
  estimateMin: number;
  reason: string;
  keep: boolean;
};

/**
 * Weekly kickoff: propose candidate tasks for this week's targets, into a
 * review list. Nothing is written until the person confirms what they kept.
 */
export function KickoffPanel({
  weekStart,
  targets,
}: {
  weekStart: string;
  targets: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function propose() {
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await runKickoff(weekStart);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(res.result.note);
      setRows(
        res.result.candidates.map((c) => ({
          title: c.title,
          weeklyTargetId: c.weeklyTargetId,
          category: c.category,
          estimateMin: c.estimateMin,
          reason: c.reason,
          keep: true,
        })),
      );
    });
  }

  function confirm() {
    if (!rows) return;
    start(async () => {
      const res = await confirmKickoff({
        tasks: rows
          .filter((r) => r.keep && r.title.trim())
          .map((r) => ({
            title: r.title.trim(),
            weeklyTargetId: r.weeklyTargetId,
            category: r.category,
            estimateMin: r.estimateMin,
          })),
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setSaved(`Created ${res.created ?? 0} task(s).`);
      setRows(null);
      router.refresh();
    });
  }

  if (targets.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No targets set for the week of {weekStart}. Set one first and the kickoff
        can propose the work that would deliver it.
      </p>
    );
  }

  const keptMin = (rows ?? []).filter((r) => r.keep).reduce((n, r) => n + r.estimateMin, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={propose} disabled={pending}>
          {pending && !rows ? "Thinking…" : "Propose this week's tasks"}
        </Button>
        <span className="text-xs text-ink-muted">
          week of {weekStart} · {targets.length} target{targets.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-settled">{saved}</p> : null}
      {note ? (
        <p className="judgment border-l-2 border-rule pl-3 text-sm text-ink-muted">{note}</p>
      ) : null}

      {rows ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">
            Uncheck anything you do not want, edit the rest. Nothing is saved
            until you confirm. Keeping {(keptMin / 60).toFixed(1)}h of work.
          </p>
          <ul className="flex flex-col gap-2 border-t border-rule pt-2">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-end gap-2 border-b border-rule pb-2">
                <label className="flex items-center gap-1.5 pb-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={r.keep}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)),
                      )
                    }
                  />
                  keep
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-ink-muted">Task</span>
                  <Input
                    value={r.title}
                    onChange={(e) =>
                      setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Target</span>
                  <Select
                    value={r.weeklyTargetId}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, j) => (j === i ? { ...x, weeklyTargetId: e.target.value } : x)),
                      )
                    }
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Category</span>
                  <Select
                    value={r.category}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, j) =>
                          j === i ? { ...x, category: e.target.value as Candidate["category"] } : x,
                        ),
                      )
                    }
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Min</span>
                  <Input
                    type="number"
                    min={5}
                    max={1440}
                    step={5}
                    value={r.estimateMin}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, j) =>
                          j === i ? { ...x, estimateMin: Number(e.target.value) || 0 } : x,
                        ),
                      )
                    }
                    className="w-24"
                  />
                </label>
                {r.reason ? (
                  <p className="judgment w-full text-xs text-ink-muted">{r.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <div>
            <Button type="button" onClick={confirm} disabled={pending}>
              {pending ? "Saving…" : "Create the kept tasks"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
