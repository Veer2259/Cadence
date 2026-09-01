import type { BucketTargetRow } from "@/lib/bucket-targets";

const hrs = (min: number) => (min / 60).toFixed(1);

/**
 * Intended hours per bucket against logged hours, this week. A statement of
 * intent — nothing schedules against it and nothing is enforced.
 */
export function BucketTargets({ rows }: { rows: BucketTargetRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No targets set and nothing logged yet. Set a weekly target on a bucket in
        Settings to see the gap here.
      </p>
    );
  }

  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.actualMin, r.targetMin ?? 0)),
  );

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const targetPct = r.targetMin ? (r.targetMin / max) * 100 : null;
        const actualPct = (r.actualMin / max) * 100;
        const over = r.ratio !== null && r.ratio > 1;
        return (
          <li key={r.bucketId} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink">{r.bucket}</span>
              <span className="tabular text-ink-muted">
                {hrs(r.actualMin)}h
                {r.targetMin ? ` / ${hrs(r.targetMin)}h` : " · no target"}
                {r.ratio !== null ? ` · ${Math.round(r.ratio * 100)}%` : ""}
              </span>
            </div>
            <div className="relative h-2 w-full border border-rule bg-paper" style={{ borderRadius: "var(--radius)" }}>
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${Math.min(100, actualPct)}%`,
                  background: over ? "var(--color-caution)" : "var(--color-ink)",
                }}
              />
              {targetPct !== null ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-signal"
                  style={{ left: `${Math.min(100, targetPct)}%` }}
                  title={`target ${hrs(r.targetMin!)}h`}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
