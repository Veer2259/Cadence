import { computeReview } from "@/lib/review";
import { AccuracyChart, BucketChart, EnergyByHourChart } from "@/components/review/charts";
import { targetHistory, outcomeProjections } from "@/lib/goal-review";
import { loadFocusScores } from "@/lib/focus-db";
import { FocusHours } from "@/components/review/focus-hours";

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
  const history = await targetHistory(8);
  const projections = await outcomeProjections();
  const focusRows = await loadFocusScores();
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

      <Panel title="Weekly targets — hit and missed">
        {history.length ? (
          <ul className="flex flex-col gap-1">
            {history.map((h, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 border-b border-rule py-1 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">
                  <span className="tabular mr-2 text-xs text-ink-muted">{h.weekStart}</span>
                  {h.description}
                  <span className="ml-1.5 text-xs text-ink-muted">{h.bucket}</span>
                </span>
                <span
                  className={
                    h.status === "hit"
                      ? "tabular shrink-0 text-xs text-settled"
                      : h.status === "missed"
                        ? "tabular shrink-0 text-xs text-signal"
                        : "tabular shrink-0 text-xs text-ink-muted"
                  }
                >
                  {h.targetHours != null ? `${h.actualHours}h / ${h.targetHours}h · ` : ""}
                  {h.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            No weekly targets recorded yet. Set some on Goals and they show up here
            once the week is reviewed.
          </p>
        )}
      </Panel>

      <Panel title="Outcomes — remaining weeks at your current rate">
        {projections.length ? (
          <ul className="flex flex-col gap-2">
            {projections.map((p) => (
              <li key={p.bucket} className="border-b border-rule pb-2 last:border-b-0">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-ink">{p.outcome}</span>
                  <span className="tabular shrink-0 text-xs text-ink-muted">
                    {p.bucket} · by {p.targetDate}
                  </span>
                </div>
                {p.verdict ? (
                  <p className="judgment mt-0.5 text-xs text-ink-muted">{p.verdict}</p>
                ) : (
                  <p className="judgment mt-0.5 text-xs text-ink-muted">
                    {p.weeksLeft} week{p.weeksLeft === 1 ? "" : "s"} left. No weekly
                    hour target set, so there is nothing to compare the rate against.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            No bucket has an outcome and a target date yet. Set one on Goals.
          </p>
        )}
      </Panel>

      <Panel title="Focus hours — learned from your deep work">
        <p className="mb-2 text-xs text-ink-muted">
          Derived from deep-work blocks on debriefed days: how close each landed
          to its estimate, and how often that slot got skipped. Green means the
          planner prefers that hour. Override any hour where the data is plainly
          wrong.
        </p>
        <FocusHours rows={focusRows} />
      </Panel>

      <Panel title="Energy by time of day">
        <p className="mb-2 text-xs text-ink-muted">
          Mean of your check-ins, last 30 days. Self-reported, and separate from
          the focus hours above — those are measured from how deep work actually
          went, not from how you felt.
        </p>
        <EnergyByHourChart data={r.energyByHour} />
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
