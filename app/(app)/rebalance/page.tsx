import Link from "next/link";
import { getCommittedPlan } from "@/lib/plan";
import { istMinutesOfDay, istToday } from "@/lib/time";
import { RebalanceForm } from "@/components/rebalance/rebalance-form";


/**
 * Server Actions inherit maxDuration from the PAGE segment they are invoked
 * from, not from the file they live in (Next.js route-segment config). Covers rebalance.
 * 
 * 300s is the Fluid compute ceiling on Vercel's Hobby plan. It is a ceiling,
 * not a reservation — a fast call still costs only what it uses.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function hm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default async function RebalancePage() {
  const live = await getCommittedPlan(istToday());

  if (!live || live.plan.debriefedAt) {
    return (
      <section className="animate-rise-in">
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Rebalance
        </h1>
        <p className="mt-2 rounded-[18px] bg-surface px-4 py-4 text-[13.5px] leading-[1.5] font-medium text-ink-muted shadow-card">
          Rebalance replans a committed day mid-way through. There is no committed
          plan open right now — commit one on{" "}
          <Link href="/today" className="font-bold text-primary underline underline-offset-2">
            Today
          </Link>
          .
        </p>
      </section>
    );
  }

  const remaining = live.blocks
    .filter((b) => b.status !== "done" && b.status !== "partial" && b.kind !== "break")
    .map((b) => ({
      title: b.title,
      startLabel: hm(istMinutesOfDay(b.startAt)),
      status: b.status,
    }));

  const lockedCount = live.blocks.filter(
    (b) => b.status === "done" || b.status === "partial",
  ).length;

  // How much of the working day is actually left. The last block's end is the
  // honest edge of the day: replanning cannot place work past it.
  const lastEnd = live.blocks.reduce(
    (n, b) => Math.max(n, istMinutesOfDay(b.endAt)),
    0,
  );
  const leftMin = Math.max(0, lastEnd - istMinutesOfDay(new Date()));

  return (
    <RebalanceForm
      remaining={remaining}
      leftMin={leftMin}
      lockedCount={lockedCount}
    />
  );
}
