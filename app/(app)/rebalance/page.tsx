import Link from "next/link";
import { getCommittedPlan } from "@/lib/plan";
import { istMinutesOfDay, istToday } from "@/lib/time";
import { RebalanceForm } from "@/components/rebalance/rebalance-form";

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
      <section>
        <h1 className="font-mono text-lg tracking-tight text-ink">Rebalance</h1>
        <p className="judgment mt-2 text-sm text-ink-muted">
          Rebalance replans a committed day mid-way through. There is no committed
          plan open right now — commit one on{" "}
          <Link href="/today" className="text-ink underline underline-offset-2">
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

  return <RebalanceForm remaining={remaining} />;
}
