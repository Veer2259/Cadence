"use client";

/**
 * "The day" section: the heading, the ribbon/list switch, and whichever view is
 * chosen. The switch is client state and deliberately not in the URL — it is a
 * viewing preference, not a thing worth making shareable or adding to history.
 */

import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  Ribbon,
  type RibbonBlock,
  type Range,
  type ProtectedRange,
} from "@/components/ribbon/ribbon";

export function DayView(props: {
  windowStartMin: number;
  windowEndMin: number;
  focusRanges: Range[];
  protectedRanges: ProtectedRange[];
  blocks: RibbonBlock[];
  isToday: boolean;
  editable?: boolean;
  initialWarnings?: string[];
  date?: string;
}) {
  const [view, setView] = useState<"ribbon" | "list">("ribbon");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em] text-ink">
          The day
        </h2>
        <div
          role="group"
          aria-label="Day view"
          className="flex gap-0.5 rounded-full bg-tint p-[3px]"
        >
          {(["ribbon", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "min-h-[32px] rounded-full px-3.5 text-[12px] font-extrabold capitalize",
                view === v ? "bg-surface text-ink shadow-tab" : "text-ink-soft",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <Ribbon {...props} view={view} />
    </section>
  );
}
