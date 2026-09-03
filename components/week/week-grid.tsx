import type { PressureDeadline, PressureDay } from "@/lib/pressure";

/**
 * Seven day cards, stacked. It used to be a 640px-wide seven-column grid that
 * scrolled sideways on a phone — the whole week was legible only to someone
 * willing to drag it.
 *
 * Status is always spelled out beside its colour. Colour is never the only
 * carrier of meaning (SPEC §9).
 */

const STATUS: Record<
  PressureDeadline["status"],
  { label: string; fg: string; bg: string }
> = {
  safe: { label: "Safe", fg: "var(--color-primary)", bg: "var(--color-primary-tint)" },
  tight: { label: "Tight", fg: "var(--color-ink-muted)", bg: "var(--color-tint)" },
  at_risk: { label: "At risk", fg: "var(--color-warn)", bg: "var(--color-warn-tint)" },
  impossible: {
    label: "Impossible",
    fg: "var(--color-warn)",
    bg: "var(--color-warn-tint)",
  },
};

/** Under two free hours reads as pressure, so the gauge turns. */
const TIGHT_HOURS = 2;

function Gauge({ freeHours, capHours }: { freeHours: number; capHours: number }) {
  const fill = Math.max(0, Math.min(1, capHours > 0 ? freeHours / capHours : 0));
  const tight = freeHours < TIGHT_HOURS;
  return (
    <span
      aria-hidden
      className="block h-2 w-16 shrink-0 overflow-hidden rounded-full bg-tint"
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${fill * 100}%`,
          background: tight ? "var(--color-warn)" : "var(--color-primary)",
        }}
      />
    </span>
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
  const capHours = Math.max(1, ...cols.map((d) => d.freeHours));
  const todayDate = cols[0]?.date;

  return (
    <div className="flex flex-col gap-2.5">
      {cols.map((day) => {
        const here = deadlines.filter((d) => d.dueDate === day.date);
        const isToday = day.date === todayDate;
        return (
          <div
            key={day.date}
            className="rounded-[18px] bg-surface p-3.5 shadow-card"
            style={
              isToday
                ? { outline: "2px solid var(--color-primary)", outlineOffset: "-2px" }
                : undefined
            }
          >
            <div className="flex items-center gap-3">
              <span
                className={`tabular flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${
                  isToday ? "bg-primary text-white" : "bg-tint text-ink-soft"
                }`}
              >
                {day.date.slice(8)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-extrabold text-ink capitalize">
                  {day.weekday}
                </span>
                <span className="tabular block text-[11px] font-semibold text-ink-faint">
                  {day.freeHours}h free
                </span>
              </span>
              <Gauge freeHours={day.freeHours} capHours={capHours} />
            </div>

            {here.length ? (
              <ul className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
                {here.map((d) => {
                  const s = STATUS[d.status];
                  return (
                    <li key={d.taskId}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">
                          {d.title}
                        </span>
                        <span
                          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                          style={{ background: s.bg, color: s.fg }}
                        >
                          {s.label}
                        </span>
                      </div>
                      <p className="tabular mt-0.5 text-[11px] font-semibold text-ink-faint">
                        {d.hoursAvailable}h free · needs {d.hoursNeeded}h
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}

      {later.length ? (
        <section className="mt-2 flex flex-col gap-2.5">
          <h2 className="text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
            Further out
          </h2>
          <ul className="flex flex-col gap-2">
            {later.map((d) => {
              const s = STATUS[d.status];
              return (
                <li
                  key={d.taskId}
                  className="flex items-center justify-between gap-2 rounded-2xl bg-surface px-3.5 py-3 shadow-card"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">
                      {d.title}
                    </span>
                    <span className="tabular block text-[11px] font-semibold text-ink-faint">
                      due {d.dueDate.slice(5)} · {d.hoursAvailable}h / {d.hoursNeeded}h
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                    style={{ background: s.bg, color: s.fg }}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {deadlines.length === 0 ? (
        <p className="rounded-[18px] bg-surface px-4 py-6 text-[13.5px] leading-[1.5] font-medium text-ink-muted shadow-card">
          No deadlines in the next two weeks. Give some tasks a due date in the
          inbox and they will show up here.
        </p>
      ) : null}
    </div>
  );
}
