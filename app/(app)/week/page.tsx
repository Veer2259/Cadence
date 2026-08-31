import { computePressure } from "@/lib/pressure";
import { WeekGrid } from "@/components/week/week-grid";
import { WeekNote } from "@/components/week/week-note";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const pressure = await computePressure();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">Week</h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          Hours each deadline needs against the hours actually free before it —
          allocated earliest-due-first, so nothing is counted twice.
        </p>
      </div>

      <WeekNote hasDeadlines={pressure.deadlines.length > 0} />

      <WeekGrid days={pressure.days} deadlines={pressure.deadlines} />
    </div>
  );
}
