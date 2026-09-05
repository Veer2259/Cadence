import type { BucketTargetRow } from "@/lib/bucket-targets";

const hrs = (min: number) => (min / 60).toFixed(1);

/**
 * Intended hours per bucket against logged hours, this week. A statement of
 * intent — nothing schedules against it and nothing is enforced.
 */
export function BucketTargets({ rows }: { rows: BucketTargetRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[18px] bg-surface px-4 py-5 text-[13.5px] font-medium text-ink-muted shadow-card">
        No targets set and nothing logged yet. Set a weekly target on a bucket in
        Settings to see the gap here.
      </p>
    );
  }

  const max = Math.max(1, ...rows.map((r) => r.actualMin));

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const actualPct = (r.actualMin / max) * 100;
        return (
          <li key={r.bucketId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
                <span
                  aria-hidden
                  className="block h-2.5 w-2.5 rounded-full"
                  style={{ background: dotFor(r.bucket) }}
                />
                {r.bucket}
              </span>
              <span className="tabular text-[11.5px] font-semibold text-ink-faint">
                {hrs(r.actualMin)}h
              </span>
            </div>

            <div className="relative">
              <div className="h-3 w-full overflow-hidden rounded-full bg-tint">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${actualPct}%`, background: dotFor(r.bucket) }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DOTS = [
  "var(--color-bucket-growth)",
  "var(--color-bucket-churn)",
  "var(--color-bucket-ops)",
  "var(--color-bucket-personal)",
];
/** Same hash as the inbox dot, so a bucket keeps one colour across screens. */
function dotFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DOTS[h % DOTS.length];
}
