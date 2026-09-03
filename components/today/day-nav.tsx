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
    "flex h-[30px] w-[34px] items-center justify-center rounded-full bg-tint text-[13px] font-bold text-ink-soft hover:text-ink";
  const label =
    rel === 0 ? "today" : rel === -1 ? "past — read only" : "planning ahead";

  return (
    <div className="flex items-center gap-1.5">
      <Link href={`/today?date=${prev}`} className={link} aria-label="Previous day">
        ←
      </Link>
      <Link href={`/today?date=${next}`} className={link} aria-label="Next day">
        →
      </Link>
      {date !== today ? (
        <Link href="/today" className={`${link} w-auto px-3 text-[11.5px]`}>
          today
        </Link>
      ) : null}
      <span className="text-[11px] font-semibold text-ink-faint">{label}</span>
    </div>
  );
}
