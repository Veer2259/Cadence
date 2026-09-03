"use client";

/**
 * "Right now" — the block you are supposed to be in, with a live countdown and
 * the one action worth having at thumb height: mark it done.
 *
 * The countdown re-reads the clock every 30s, the same cadence as the now-line.
 * Anything faster is a second hand nobody asked for.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { describeThrown } from "@/lib/thrown";
import { Button } from "@/components/ui/controls";
import { setBlockStatus } from "@/app/(app)/today/actions";

export type MomentumBlock = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  bucket: string | null;
  deferCount: number;
  status: "planned" | "done" | "partial" | "skipped";
};

function istNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

const hm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

export function MomentumCard({
  block,
  date,
  hasPlan,
}: {
  block: MomentumBlock | null;
  date: string;
  hasPlan: boolean;
}) {
  const router = useRouter();
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  // Null until mount so the server and client render identical HTML.
  useEffect(() => {
    const read = () => setNowMin(istNowMinutes());
    read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  }, []);

  function mark() {
    setError(null);
    if (!block) return;
    const next = block.status === "done" ? "planned" : "done";
    start(async () => {
      let res;
      try {
        res = await setBlockStatus({ date, blockId: block.id, status: next });
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (!block) {
    return (
      <div className="animate-pop rounded-[22px] bg-surface p-4 shadow-hero">
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
          Right now
        </p>
        <p className="mt-1.5 text-[20px] leading-tight font-extrabold tracking-[-0.025em] text-ink">
          Nothing scheduled
        </p>
        <p className="mt-1 text-[12.5px] font-semibold text-ink-faint">
          {hasPlan
            ? "Nothing is planned for this moment."
            : "No plan yet for this day."}
        </p>
        <Link href={`/today?date=${date}`} className="mt-3 block">
          <Button className="w-full" size="lg">
            {hasPlan ? "See the day" : "Plan my day"}
          </Button>
        </Link>
      </div>
    );
  }

  const duration = block.endMin - block.startMin;
  const elapsed = nowMin == null ? 0 : Math.max(0, Math.min(duration, nowMin - block.startMin));
  const left = Math.max(0, duration - elapsed);
  const done = block.status === "done";

  const meta = [
    block.bucket,
    block.deferCount > 0 ? `deferred ${block.deferCount}×` : null,
    `${hm(block.startMin)}–${hm(block.endMin)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="animate-pop rounded-[22px] bg-surface p-4 shadow-hero">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="animate-glow block h-2 w-2 rounded-full bg-primary"
        />
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
          Right now{nowMin == null ? "" : ` · ${hm(nowMin)}`}
        </p>
      </div>

      <p className="mt-1.5 text-[20px] leading-tight font-extrabold tracking-[-0.025em] text-ink">
        {block.title}
      </p>
      <p className="mt-0.5 text-[12.5px] font-semibold text-ink-faint">{meta}</p>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="tabular text-[32px] leading-none font-extrabold tracking-[-0.04em] text-primary">
          {nowMin == null ? "—" : left}
        </span>
        <span className="text-[12.5px] font-semibold text-ink-soft">
          minutes left of {duration}
        </span>
      </div>

      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-tint">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${duration > 0 ? (elapsed / duration) * 100 : 0}%` }}
        />
      </div>

      <div className="mt-3.5 flex gap-2">
        <Button
          onClick={mark}
          disabled={saving}
          size="lg"
          variant={done ? "quiet" : "primary"}
          className={cn("flex-1", done && "bg-primary-tint text-primary-deep")}
        >
          {done ? "Logged ✓" : "Mark done"}
        </Button>
        <Link href="/rebalance" className="shrink-0">
          <Button variant="quiet" size="lg" className="whitespace-nowrap">
            Rebalance
          </Button>
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
