import { cn } from "@/lib/cn";
import type { PressureDeadline, PressureDay } from "@/lib/pressure";

const STATUS_COLOR: Record<PressureDeadline["status"], string> = {
  safe: "var(--color-settled)",
  tight: "var(--color-ink-muted)",
  at_risk: "var(--color-caution)",
  impossible: "var(--color-signal)",
};

const STATUS_LABEL: Record<PressureDeadline["status"], string> = {
  safe: "safe",
  tight: "tight",
  at_risk: "at risk",
  impossible: "impossible",
};

function DeadlineBar({ d }: { d: PressureDeadline }) {
  const color = STATUS_COLOR[d.status];
  const need = Math.max(d.hoursNeeded, 0.01);
  const fill = Math.max(0, Math.min(1, d.hoursAvailable / need));
  return (
    <div className="border-l-2 py-1 pl-2" style={{ borderColor: color }}>
      <p className="truncate text-xs text-ink">{d.title}</p>
      <div className="mt-1 h-1.5 w-full bg-rule/60" style={{ borderRadius: "1px" }}>
        <div className="h-full" style={{ width: `${fill * 100}%`, background: color, borderRadius: "1px" }} />
      </div>
      <p className="tabular mt-0.5 text-[10px] text-ink-muted">
        {d.hoursAvailable}h free / {d.hoursNeeded}h need · {STATUS_LABEL[d.status]}
      </p>
    </div>
  );
}

export function WeekGrid({
  days,
  deadlines,
}: {
  days: PressureDay[];
  deadlines: PressureDeadline[];
}) {
  const cols = days.slice(0, 7);
  const shownDates = new Set(cols.map((d) => d.date));
  const later = deadlines.filter((d) => !shownDates.has(d.dueDate));

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-2">
          {cols.map((day) => {
            const here = deadlines.filter((d) => d.dueDate === day.date);
            return (
              <div key={day.date} className="border border-rule bg-surface p-2" style={{ borderRadius: "var(--radius)" }}>
                <div className="border-b border-rule pb-1">
                  <p className="text-xs font-medium text-ink capitalize">{day.weekday}</p>
                  <p className="tabular text-[10px] text-ink-muted">
                    {day.date.slice(5)} · {day.freeHours}h free
                  </p>
                </div>
                <div className="mt-1 flex flex-col gap-1.5">
                  {here.length ? (
                    here.map((d) => <DeadlineBar key={d.taskId} d={d} />)
                  ) : (
                    <p className="py-2 text-[10px] text-ink-muted">—</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {later.length ? (
        <div>
          <h2 className="mb-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
            Further out
          </h2>
          <ul className="border-t border-rule">
            {later.map((d) => (
              <li key={d.taskId} className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-b-0">
                <span className="truncate text-sm text-ink">{d.title}</span>
                <span className="tabular shrink-0 text-xs text-ink-muted">
                  due {d.dueDate.slice(5)} · {d.hoursAvailable}h / {d.hoursNeeded}h ·{" "}
                  <span className={cn(d.status === "impossible" && "text-signal", d.status === "at_risk" && "text-caution")}>
                    {STATUS_LABEL[d.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {deadlines.length === 0 ? (
        <p className="border border-rule bg-surface p-6 text-sm text-ink-muted" style={{ borderRadius: "var(--radius)" }}>
          No deadlines in the next two weeks. Give some tasks a due date in the
          inbox and they will show up here.
        </p>
      ) : null}
    </div>
  );
}
