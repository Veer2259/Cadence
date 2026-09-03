import { computeReview } from "@/lib/review";
import { AccuracyChart, BucketChart, EnergyByHourChart } from "@/components/review/charts";
import { targetHistory, outcomeProjections } from "@/lib/goal-review";
import { loadFocusScores } from "@/lib/focus-db";
import { FocusHours } from "@/components/review/focus-hours";

export const dynamic = "force-dynamic";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] bg-surface p-4 shadow-card">
      <h2 className="mb-2 text-[15px] font-extrabold tracking-[-0.02em] text-ink">
        {title}
      </h2>
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
    <div className="animate-rise-in flex flex-col gap-2.5">
      <div>
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Review
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] font-medium text-ink-muted">
          How the estimates are converging, where the hours actually go.
        </p>
      </div>

      {latest ? (
        <div className="rounded-[18px] bg-surface p-4 shadow-card">
          <p className="text-[10px] font-bold tracking-[0.1em] text-ink-soft uppercase">
            Estimate accuracy
          </p>
          <p
            className="tabular mt-0.5 text-[22px] font-extrabold tracking-[-0.03em]"
            style={{
              color:
                latest.ratio > 1.15 ? "var(--color-caution)" : "var(--color-primary)",
            }}
          >
            {latest.ratio}×
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-ink-faint">
            {latest.ratio > 1.05
              ? "You run over your estimates."
              : latest.ratio < 0.95
                ? "You finish ahead of your estimates."
                : "Your estimates are landing."}
          </p>
        </div>
      ) : null}

      <Panel title={`Estimate accuracy over time${latest ? ` — last ${latest.ratio}×` : ""}`}>
        <p className="mb-2 text-[12px] font-semibold text-ink-faint">
          actual ÷ estimate per debriefed day. The dashed line is 1.0 — dead-on.
        </p>
        <AccuracyChart data={r.accuracy} />
      </Panel>

      <Panel title="Hours per bucket">
        <p className="mb-2 text-[12px] font-semibold text-ink-faint">
          Dark = last 7 days, light = last 30.
        </p>
        <BucketChart data={r.buckets} />
      </Panel>

      <Panel title="Weekly targets — hit and missed">
        {history.length ? (
          <ul className="flex flex-col gap-1">
            {history.map((h, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 border-b border-line py-1.5 text-[13px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">
                  <span className="tabular mr-2 text-[11px] font-semibold text-ink-faint">{h.weekStart}</span>
                  {h.description}
                  <span className="ml-1.5 text-[11px] font-semibold text-ink-faint">{h.bucket}</span>
                </span>
                <span
                  className={
                    h.status === "hit"
                      ? "tabular shrink-0 text-xs text-primary"
                      : h.status === "missed"
                        ? "tabular shrink-0 text-xs text-warn"
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
              <li key={p.bucket} className="border-b border-line pb-2 last:border-b-0">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-ink">{p.outcome}</span>
                  <span className="tabular shrink-0 text-xs text-ink-muted">
                    {p.bucket} · by {p.targetDate}
                  </span>
                </div>
                {p.verdict ? (
                  <p className="mt-0.5 text-xs text-ink-muted">{p.verdict}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-ink-muted">
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
        <p className="mb-2 text-[12px] font-semibold text-ink-faint">
          Derived from deep-work blocks on debriefed days: how close each landed
          to its estimate, and how often that slot got skipped. Green means the
          planner prefers that hour. Override any hour where the data is plainly
          wrong.
        </p>
        <FocusHours rows={focusRows} />
      </Panel>

      <Panel title="Energy by time of day">
        <p className="mb-2 text-[12px] font-semibold text-ink-faint">
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
                <tr key={c.category} className="border-t border-line">
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
          <ul className="border-t border-line">
            {r.deferLeaderboard.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0"
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
