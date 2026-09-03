/**
 * The capacity ring: how much of the daily cap today's plan spends.
 *
 * r=29 gives a circumference of 182, which is the number the ringDraw keyframe
 * animates from — keep them in step if the radius ever changes.
 */

const R = 29;
const CIRC = Math.round(2 * Math.PI * R); // 182

export function CapacityRing({
  plannedMin,
  capMin,
}: {
  plannedMin: number;
  capMin: number;
}) {
  const fraction = capMin > 0 ? Math.min(1, plannedMin / capMin) : 0;
  const pct = Math.round(fraction * 100);

  return (
    <div className="relative h-[74px] w-[74px] shrink-0">
      <svg
        width="74"
        height="74"
        viewBox="0 0 74 74"
        role="img"
        aria-label={`${pct}% of your daily cap is planned`}
      >
        <circle
          cx="37"
          cy="37"
          r={R}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="9"
        />
        <circle
          className="animate-ring-draw"
          cx="37"
          cy="37"
          r={R}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${Math.round(fraction * CIRC)} ${CIRC}`}
          transform="rotate(-90 37 37)"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[15px] leading-none font-extrabold text-ink">
          {pct}%
        </span>
        <span className="mt-0.5 text-[9px] font-bold text-ink-soft">of cap</span>
      </div>
    </div>
  );
}
