/**
 * The streak card. Also used on Today (step 3), which is why it lives here
 * rather than inside the More page.
 *
 * The count is the run of closed days ending YESTERDAY — see lib/streak.ts for
 * why today is excluded. With no run yet the card says so plainly rather than
 * showing a zero dressed up as progress.
 */

export function StreakBanner({
  streak,
  best,
  subtitle,
}: {
  streak: number;
  best: number;
  subtitle?: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-[18px] px-4 py-3.5"
      style={{ background: "linear-gradient(var(--color-primary), var(--color-primary-deep))" }}
    >
      <StarMark className="animate-spark shrink-0 text-paper" size={26} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-paper">
          {streak === 0
            ? "No run yet — close a day to start one"
            : `${streak} day${streak === 1 ? "" : "s"} closed in a row`}
        </p>
        <p className="text-[11.5px] font-semibold text-paper/80">
          {subtitle ?? (best === 0 ? "Nothing closed so far" : `Best run so far: ${best} days`)}
        </p>
      </div>
    </div>
  );
}

/** The eight-point star. Used by the streak card, login and the day-close reward. */
export function StarMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="currentColor"
    >
      <path d="M12 0l1.9 8.2L22 6l-5.3 6L22 18l-8.1-2.2L12 24l-1.9-8.2L2 18l5.3-6L2 6l8.1 2.2z" />
    </svg>
  );
}
