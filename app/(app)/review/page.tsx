import { computeReview } from "@/lib/review";
import { AccuracyChart, BucketChart, EnergyByHourChart } from "@/components/review/charts";
import { MIN_DAYS } from "@/lib/energy";
import { listMilestoneProgress } from "@/lib/milestones";
import { istToday } from "@/lib/time";

export const dynamic = "force-dynamic";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-4">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-ink uppercase">{title}</h2>
      {children}
    </section>
  );
}

export default async function ReviewPage() {
  const r = await computeReview();
  const milestones = await listMilestoneProgress(istToday());
  const latest = r.accuracy.at(-1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">Review</h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          How the estimates are converging, where the hours actually go.
        </p>
      </div>

      <Panel title={`Estimate accuracy over time${latest ? ` — last ${latest.ratio}×` : ""}`}>
        <p className="mb-2 text-xs text-ink-muted">
          actual ÷ estimate per debriefed day. The dashed line is 1.0 — dead-on.
        </p>
        <AccuracyChart data={r.accuracy} />
      </Panel>

      <Panel title="Hours per bucket">
        <p className="mb-2 text-xs text-ink-muted">
          Dark = last 7 days, light = last 30.
        </p>
        <BucketChart data={r.buckets} />
      </Panel>

      <Panel title="Milestone progress">
        {milestones.length ? (
          <ul className="flex flex-col gap-2">
            {milestones.map((m) => {
              const pct = m.fraction === null ? null : Math.round(m.fraction * 100);
              const overdue = m.daysLeft < 0 && !m.completedAt;
              return (
                <li key={m.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className={m.completedAt ? "text-ink-muted line-through" : "text-ink"}>
                      {m.name}
                      {m.bucketName ? (
                        <span className="ml-1.5 text-ink-muted">{m.bucketName}</span>
                      ) : null}
                    </span>
                    <span className={overdue ? "tabular text-signal" : "tabular text-ink-muted"}>
                      {pct === null ? "no tasks linked" : `${m.doneTasks}/${m.totalTasks} · ${pct}%`}
                      {" · "}
                      {m.completedAt
                        ? "reached"
                        : m.daysLeft === 0
                          ? "due today"
                          : m.daysLeft > 0
                            ? `${m.daysLeft}d left`
                            : `${Math.abs(m.daysLeft)}d overdue`}
                    </span>
                  </div>
                  <div
                    className="h-2 w-full border border-rule bg-paper"
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${pct ?? 0}%`,
                        background: m.completedAt
                          ? "var(--color-settled)"
                          : overdue
                            ? "var(--color-signal)"
                            : "var(--color-ink)",
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            No milestones yet. Add one in Settings — a name, a date and a bucket —
            then link tasks to it from the inbox.
          </p>
        )}
      </Panel>

      <Panel title="Energy by time of day">
        <p className="mb-2 text-xs text-ink-muted">
          Mean of your check-ins, last 30 days. The dashed line is the bar an hour
          has to clear to count as a sharp hour.
        </p>
        <EnergyByHourChart data={r.energyByHour} />
        {r.sharpSuggestion.sampleN > 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {r.sharpSuggestion.sampleN} check-in
            {r.sharpSuggestion.sampleN === 1 ? "" : "s"} across{" "}
            {r.sharpSuggestion.dayN} day{r.sharpSuggestion.dayN === 1 ? "" : "s"}.{" "}
            {r.sharpSuggestion.confident ? (
              <>
                Enough to act on — Settings can apply it to your sharp hours.
              </>
            ) : (
              <>
                Needs {Math.max(0, MIN_DAYS - r.sharpSuggestion.dayN)} more day
                {MIN_DAYS - r.sharpSuggestion.dayN === 1 ? "" : "s"} before it is
                worth acting on.
              </>
            )}
          </p>
        ) : null}
      </Panel>

      <Panel title="Calibration by category">
        {r.categories.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="py-1 font-medium">category</th>
                <th className="py-1 font-medium">ratio</th>
                <th className="py-1 font-medium">samples</th>
              </tr>
            </thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.category} className="border-t border-rule">
                  <td className="py-1.5">{c.category}</td>
                  <td className="tabular py-1.5">
                    {c.ratio}×
                    {c.sampleN >= 3 ? (
                      <span className="ml-1 text-xs text-ink-muted">applied</span>
                    ) : (
                      <span className="ml-1 text-xs text-ink-muted">
                        needs {3 - c.sampleN} more
                      </span>
                    )}
                  </td>
                  <td className="tabular py-1.5">{c.sampleN}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-muted">
            No samples yet. Calibration starts learning at your first debrief.
          </p>
        )}
      </Panel>

      <Panel title="Defer leaderboard">
        {r.deferLeaderboard.length ? (
          <ul className="border-t border-rule">
            {r.deferLeaderboard.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-b border-rule py-1.5 last:border-b-0"
              >
                <span className="truncate text-sm text-ink">
                  {d.title}
                  {d.status !== "active" ? (
                    <span className="ml-2 text-xs text-ink-muted">{d.status}</span>
                  ) : null}
                </span>
                <span className="tabular shrink-0 text-xs text-ink-muted">
                  pushed {d.deferCount}×
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Nothing has been carried over. Good.</p>
        )}
      </Panel>
    </div>
  );
}
