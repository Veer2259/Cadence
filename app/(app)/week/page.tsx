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

  const freeThisWeek =
    Math.round(pressure.days.slice(0, 7).reduce((n, d) => n + d.freeHours, 0) * 10) / 10;
  const atRisk = pressure.deadlines.filter(
    (d) => d.status === "at_risk" || d.status === "impossible",
  ).length;

  return (
    <div className="animate-rise-in flex flex-col gap-3">
      <div>
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          This week
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] font-medium text-ink-muted">
          Hours each deadline needs against the hours actually free before it —
          allocated earliest-due-first, so nothing is counted twice.
        </p>
      </div>

      <div className="flex gap-2.5">
        <div
          className="flex-1 rounded-2xl px-3.5 py-3"
          style={{ background: "linear-gradient(var(--color-primary), var(--color-primary-deep))" }}
        >
          <p className="text-[10px] font-bold tracking-[0.1em] text-paper/80 uppercase">
            Free this week
          </p>
          <p className="tabular mt-0.5 text-[20px] font-extrabold text-paper">
            {freeThisWeek}h
          </p>
        </div>
        <div className="flex-1 rounded-2xl bg-warn-tint px-3.5 py-3">
          <p className="text-[10px] font-bold tracking-[0.1em] text-warn uppercase">
            At risk
          </p>
          <p className="tabular mt-0.5 text-[20px] font-extrabold text-warn">
            {atRisk} deadline{atRisk === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <WeekNote hasDeadlines={pressure.deadlines.length > 0} />

      <WeekGrid days={pressure.days} deadlines={pressure.deadlines} />

      <section className="mt-2">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em] text-ink">
          Hours per bucket
        </h2>
        <p className="mt-1 mb-3 text-[12px] font-semibold text-ink-faint">
          This week ({weekStart} → {weekEnd}). The notch is the target; the bar is
          what you actually logged.
        </p>
        <BucketTargets rows={targets} />
      </section>

      <section className="mt-2">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em] text-ink">
          This week&rsquo;s targets
        </h2>
        <p className="mt-1 mb-3 text-[12px] font-semibold text-ink-faint">
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
                <li key={t.id} className="flex flex-col gap-1 rounded-[18px] bg-surface p-3.5 shadow-card">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-bold text-ink">{t.description}</span>
                    <span className="tabular shrink-0 text-[11.5px] font-semibold text-ink-faint">
                      {t.bucketName}
                      {t.targetHours != null
                        ? ` · ${t.actualHours}h / ${t.targetHours}h`
                        : ` · ${t.actualHours}h logged`}
                      {t.totalTasks > 0 ? ` · ${t.doneTasks}/${t.totalTasks} tasks` : ""}
                    </span>
                  </div>
                  {gp.note ? (
                    <p className="text-[12px] font-semibold text-caution">{gp.note}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-[18px] bg-surface px-4 py-5 text-[13.5px] font-medium text-ink-muted shadow-card">
            No targets set for this week. Set them on Goals.
          </p>
        )}
      </section>
    </div>
  );
}
