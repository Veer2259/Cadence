import Link from "next/link";

/**
 * Move between days on the Today screen. A plain set of links, not client
 * state — the date lives in the URL so a day is shareable, refreshable, and
 * survives the back button.
 */
export function DayNav({
  date,
  prev,
  next,
  today,
  rel,
}: {
  date: string;
  prev: string;
  next: string;
  today: string;
  /** -1 past, 0 today, +1 future */
  rel: -1 | 0 | 1;
}) {
  const link =
    "border border-rule bg-surface px-2 py-0.5 text-xs text-ink-muted hover:border-ink hover:text-ink";
  const label =
    rel === 0 ? "today" : rel === -1 ? "past — read only" : "planning ahead";

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Link href={`/today?date=${prev}`} className={link} style={{ borderRadius: "var(--radius)" }} aria-label="Previous day">
        ←
      </Link>
      <Link href={`/today?date=${next}`} className={link} style={{ borderRadius: "var(--radius)" }} aria-label="Next day">
        →
      </Link>
      {date !== today ? (
        <Link href="/today" className={link} style={{ borderRadius: "var(--radius)" }}>
          today
        </Link>
      ) : null}
      <span className="tabular text-xs text-ink-muted">{label}</span>
    </div>
  );
}
