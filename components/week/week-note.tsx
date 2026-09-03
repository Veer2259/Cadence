"use client";

import { useEffect, useState } from "react";
import { getWeekNote, type WeekNotePayload } from "@/app/(app)/week/actions";

export function WeekNote({ hasDeadlines }: { hasDeadlines: boolean }) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "done"; data: WeekNotePayload } | { phase: "error"; msg: string }
  >(() =>
    hasDeadlines
      ? { phase: "loading" }
      : { phase: "done", data: { weekNote: "No deadlines in the next two weeks.", lines: [] } },
  );

  useEffect(() => {
    if (!hasDeadlines) return;
    let live = true;
    getWeekNote().then((res) => {
      if (!live) return;
      setState(res.ok ? { phase: "done", data: res.data } : { phase: "error", msg: res.error });
    });
    return () => {
      live = false;
    };
  }, [hasDeadlines]);

  if (state.phase === "loading") {
    return <p className="text-sm text-ink-muted">Reading the week…</p>;
  }
  if (state.phase === "error") {
    return <p className="text-[13px] font-semibold text-warn">{state.msg}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-[18px] bg-surface px-4 py-3 text-[14px] leading-[1.5] font-medium text-ink-muted shadow-card">
        {state.data.weekNote}
      </p>
      {state.data.lines.length ? (
        <ul className="flex flex-col gap-1 text-xs text-ink-muted">
          {state.data.lines.map((l) => (
            <li key={l.taskId}>· {l.line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
