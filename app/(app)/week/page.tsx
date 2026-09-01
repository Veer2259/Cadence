import { computePressure } from "@/lib/pressure";
import { bucketTargets } from "@/lib/bucket-targets";
import { BucketTargets } from "@/components/week/bucket-targets";
import { istToday, addIstDays } from "@/lib/time";
import { weeklyTargetsFor, weekStartOf } from "@/lib/goals";
import { goalPressure } from "@/lib/goal-pressure";
import { WeekGrid } from "@/components/week/week-grid";
import { WeekNote } from "@/components/week/week-note";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const pressure = await computePressure();

  // the current week, Monday-anchored, in IST
  const today = istToday();
  const dow = new Date(`${today}T12:00:00+05:30`).getUTCDay(); // 0 Sun .. 6 Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const weekStart = addIstDays(today, -backToMonday);
  const weekEnd = addIstDays(weekStart, 6);
  const targets = await bucketTargets(weekStart, weekEnd);
  const weekTargets = await weeklyTargetsFor(weekStartOf(today));
  const dayIndexInWeek = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${weekStartOf(today)}T00:00:00Z`)) /
      86_400_000,
  );

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

      <section className="border-t border-rule pt-4">
        <h2 className="mb-1 text-xs font-medium tracking-wide text-ink uppercase">
          Hours per bucket against target
        </h2>
        <p className="mb-3 text-xs text-ink-muted">
          This week ({weekStart} → {weekEnd}). The red hairline is the target;
          the bar is what you actually logged.
        </p>
        <BucketTargets rows={targets} />
      </section>

      <section className="border-t border-rule pt-4">
        <h2 className="mb-1 text-xs font-medium tracking-wide text-ink uppercase">
          This week&rsquo;s targets
        </h2>
        <p className="mb-3 text-xs text-ink-muted">
          Where each target stands against how much of the week has gone.
        </p>
        {weekTargets.length ? (
          <ul className="flex flex-col gap-2">
            {weekTargets.map((t) => {
              const gp = goalPressure({
                targetHours: t.targetHours,
                actualHours: t.actualHours,
                totalTasks: t.totalTasks,
                doneTasks: t.doneTasks,
                dayIndexInWeek,
              });
              return (
                <li key={t.id} className="flex flex-col gap-0.5 border-b border-rule pb-2 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-ink">{t.description}</span>
                    <span className="tabular shrink-0 text-xs text-ink-muted">
                      {t.bucketName}
                      {t.targetHours != null
                        ? ` · ${t.actualHours}h / ${t.targetHours}h`
                        : ` · ${t.actualHours}h logged`}
                      {t.totalTasks > 0 ? ` · ${t.doneTasks}/${t.totalTasks} tasks` : ""}
                    </span>
                  </div>
                  {gp.note ? (
                    <p className="judgment text-xs text-caution">{gp.note}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            No targets set for this week. Set them on Goals.
          </p>
        )}
      </section>
    </div>
  );
}
