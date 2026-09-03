/**
 * The streak card on Today: the run of closed days, today's logging progress,
 * and seven dots for the last seven days.
 *
 * The count excludes today deliberately (lib/streak.ts). The dots show the same
 * seven days the count walks, so the card cannot contradict itself.
 */

import { StarMark } from "@/components/more/streak-banner";

export function StreakCard({
  streak,
  best,
  week,
  loggedLabel,
}: {
  streak: number;
  best: number;
  week: { date: string; closed: boolean }[];
  loggedLabel: string | null;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-[18px] px-4 py-3.5"
      style={{ background: "linear-gradient(var(--color-primary), var(--color-primary-deep))" }}
    >
      <StarMark className="animate-spark shrink-0" size={26} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-paper">
          {streak === 0
            ? "No run yet — close a day to start one"
            : `${streak} day${streak === 1 ? "" : "s"} closed in a row`}
        </p>
        <p className="text-[11.5px] font-semibold text-paper/80">
          {loggedLabel ?? (best === 0 ? "Nothing closed so far" : `Best run so far: ${best} days`)}
        </p>
      </div>

      <div
        className="flex shrink-0 gap-1"
        role="img"
        aria-label={`${week.filter((d) => d.closed).length} of the last 7 days closed`}
      >
        {week.map((d) => (
          <span
            key={d.date}
            className="block h-1.5 w-1.5 rounded-full"
            style={{
              background: d.closed ? "var(--color-paper)" : "rgba(253,248,240,.35)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
