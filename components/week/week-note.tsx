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
    return <p className="text-sm text-signal">{state.msg}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="judgment border-l-2 border-rule pl-3 text-sm text-ink">
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
