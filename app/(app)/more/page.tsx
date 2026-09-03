import Link from "next/link";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { istToday } from "@/lib/time";
import { streakEndingYesterday, longestStreak } from "@/lib/streak";
import { logout } from "@/app/(app)/actions";
import { StreakBanner } from "@/components/more/streak-banner";

export const dynamic = "force-dynamic";

/**
 * The hub for everything the five-tab bar cannot hold. Goals, Review, Debrief,
 * Rebalance and Settings all used to be top-level nav items; at phone width
 * that bar overflowed, so they live one tap deeper.
 */

const LINKS = [
  {
    href: "/goals",
    label: "Goals",
    hint: "Outcomes, weekly targets, breakdown",
    dot: "var(--color-bucket-personal)",
  },
  {
    href: "/review",
    label: "Review",
    hint: "Accuracy, where you misjudge, what slips",
    dot: "var(--color-bucket-ops)",
  },
  {
    href: "/debrief",
    label: "Debrief",
    hint: "Close today and log what really happened",
    dot: "var(--color-primary)",
  },
  {
    href: "/rebalance",
    label: "Rebalance",
    hint: "Replan the rest of the day",
    dot: "var(--color-bucket-churn)",
  },
  {
    href: "/settings",
    label: "Settings",
    hint: "Work windows, buckets, habits",
    dot: "var(--color-bucket-fixed)",
  },
] as const;

export default async function MorePage() {
  const closed = await db
    .select({ date: plans.date })
    .from(plans)
    .where(isNotNull(plans.debriefedAt))
    .orderBy(desc(plans.date));

  const closedDates = closed.map((r) => r.date);
  const today = istToday();
  const streak = streakEndingYesterday(closedDates, today);
  const best = longestStreak(closedDates);

  return (
    <div className="animate-rise-in flex flex-col gap-2.5">
      <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
        More
      </h1>

      <div className="mt-2">
        <StreakBanner streak={streak} best={best} />
      </div>

      <div className="mt-1 flex flex-col gap-2.5">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 shadow-card"
          >
            <span
              aria-hidden
              className="block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: l.dot }}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-extrabold tracking-[-0.02em] text-ink">
                {l.label}
              </span>
              <span className="block text-[11.5px] font-semibold text-ink-faint">
                {l.hint}
              </span>
            </span>
            <span aria-hidden className="text-ink-ghost">
              ›
            </span>
          </Link>
        ))}
      </div>

      <form action={logout} className="mt-3">
        <button
          type="submit"
          className="min-h-[46px] w-full rounded-full bg-tint text-sm font-extrabold text-warn"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
