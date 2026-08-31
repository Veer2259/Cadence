import Link from "next/link";
import { formatIst, istMinutesOfDay } from "@/lib/time";
import { getPlanToDebrief } from "@/lib/debrief";
import { DebriefForm, type DebriefBlock } from "@/components/debrief/debrief-form";

export const dynamic = "force-dynamic";

function hm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default async function DebriefPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const dateStr = typeof sp.date === "string" ? sp.date : undefined;

  const target = await getPlanToDebrief(dateStr);

  if (!target) {
    return (
      <section>
        <h1 className="font-mono text-lg tracking-tight text-ink">Debrief</h1>
        <p className="judgment mt-2 text-sm text-ink-muted">
          Nothing to close out. Commit a plan on{" "}
          <Link href="/today" className="text-ink underline underline-offset-2">
            Today
          </Link>{" "}
          first, or this day has already been debriefed.
        </p>
      </section>
    );
  }

  const dateLabel = formatIst(new Date(`${target.plan.date}T12:00:00+05:30`), "EEEE d MMMM");

  // Breaks are auto-logged; the user only touches real activity.
  const blocks: DebriefBlock[] = target.blockRows
    .filter((b) => b.kind !== "break")
    .map((b) => ({
      id: b.id,
      title: b.title,
      kind: b.kind,
      category: b.category,
      plannedMin: b.estimateMin,
      startLabel: hm(istMinutesOfDay(b.startAt)),
    }));

  return <DebriefForm planId={target.plan.id} dateLabel={dateLabel} blocks={blocks} />;
}
