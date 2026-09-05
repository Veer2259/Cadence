"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/controls";
import {
  planMyDay,
  commitTodayPlan,
  discardTodayPlan,
  type PlanActionResult,
} from "@/app/(app)/today/actions";
import { describeThrown } from "@/lib/thrown";

const PROGRESS = [
  "Reading your active tasks…",
  "Weighing deadlines and how long things really take…",
  "Placing blocks in your sharp hours…",
  "Checking nothing overlaps or overflows…",
];

export function PlanActions({
  status,
  planId,
  date,
  readOnly = false,
  isToday = true,
  debriefed = false,
}: {
  status: "none" | "draft" | "committed";
  planId?: string;
  /** the IST day being viewed; writes are scoped to it */
  date?: string;
  /** a past day — a record, so offer nothing that writes */
  readOnly?: boolean;
  /** is the viewed day the current IST day? decided on the server, which knows
   *  the timezone — the client's UTC date is wrong for ~5.5h either side of
   *  IST midnight */
  isToday?: boolean;
  debriefed?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Progress messaging: one always-on tick; the stage is elapsed ticks since the
  // run began (set in the event handler, never in an effect).
  const [tick, setTick] = useState(0);
  const [startTick, setStartTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 4000);
    return () => clearInterval(id);
  }, []);
  const stage = Math.min(Math.max(0, tick - startTick), PROGRESS.length - 1);
  const message = PROGRESS[stage];

  function run(fn: () => Promise<PlanActionResult>, isCompose = false) {
    setError(null);
    setWarnings([]);
    setProgress(isCompose);
    setStartTick(tick);
    start(async () => {
      // Returned failures render below; a THROWN one (function timeout, dropped
      // connection) would otherwise reject unhandled and leave the button stuck.
      let res: PlanActionResult;
      try {
        res = await fn();
      } catch (e) {
        setProgress(false);
        setError(describeThrown(e));
        return;
      }
      setProgress(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.violations.length) setWarnings(res.violations);
      router.refresh();
    });
  }

  // A past day is a record: show its plan, offer nothing that would change it.
  if (readOnly) {
    return (
      <span className="text-[12px] font-semibold text-ink-faint">
        {status === "none" ? "No plan for this day." : "Past day — read only."}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "none" ? (
          <Button onClick={() => run(() => planMyDay(date), true)} disabled={pending}>
            {pending ? "Planning…" : isToday ? "Plan my day" : "Plan this day"}
          </Button>
        ) : null}

        {status === "draft" && planId ? (
          <>
            <Button onClick={() => run(() => commitTodayPlan(planId))} disabled={pending}>
              Commit plan
            </Button>
            <Button
              variant="quiet"
              onClick={() => run(() => planMyDay(date), true)}
              disabled={pending}
            >
              {pending ? "Re-planning…" : "Re-plan"}
            </Button>
            <Button
              variant="danger"
              onClick={() => run(() => discardTodayPlan(planId))}
              disabled={pending}
            >
              Discard
            </Button>
          </>
        ) : null}

        {status === "committed" && !debriefed ? (
          <>
            <Link
              href="/debrief"
              className="inline-flex min-h-[42px] items-center rounded-full bg-ink px-4 text-sm font-extrabold text-paper"
            >
              Close the day
            </Link>
          </>
        ) : null}

        {status === "committed" && debriefed ? (
          <span className="text-[12px] font-semibold text-ink-faint">Day closed.</span>
        ) : null}
      </div>

      {pending && progress ? (
        <p className="text-[13px] font-semibold text-ink-soft" aria-live="polite">
          {message}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-warn">
          {error}
        </p>
      ) : null}

      {warnings.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">
            The plan was saved, but these checks still failed:
          </p>
          <ul className="list-disc pl-4 text-[12.5px] font-medium text-ink-muted">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
