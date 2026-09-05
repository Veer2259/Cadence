"use client";

import { askCadence } from "@/lib/ask-cadence";

export type OverflowView = {
  id: string;
  title: string;
  reason: string;
  action: "defer" | "shrink" | "delegate" | "drop";
  suggestion: string;
};

/**
 * "This doesn't fit today" — the app saying no, out loud (SPEC §1, principle 2).
 * Renders nothing when everything fits.
 *
 * The suggestion is a REAL button. It used to be a `<p>` styled as a dark pill:
 * it looked exactly like a control, sat at a 38px tap target, and did nothing at
 * all. Tapping it now opens the assistant with the instruction already written,
 * so the recommended action is one send away instead of something to re-type.
 *
 * The action word (MOVE / DROP / …) is a LABEL, not a control, and is styled as
 * one — it describes what the planner recommends, and promising a tap it cannot
 * honour is the same mistake in miniature.
 */

const ACTION_LABEL: Record<OverflowView["action"], string> = {
  defer: "Move",
  shrink: "Shrink",
  delegate: "Delegate",
  drop: "Drop",
};

export function OverflowList({ items }: { items: OverflowView[] }) {
  if (!items.length) return null;

  const n = items.length;
  const heading =
    n === 1 ? "One thing won't fit" : n === 2 ? "Two things won't fit" : `${n} things won't fit`;

  return (
    <section className="rounded-[20px] border border-warn-line bg-warn-tint p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-warn text-[13px] font-extrabold text-white"
        >
          !
        </span>
        <h2 className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">
          {heading}
        </h2>
      </div>

      <ul className="mt-3 flex flex-col gap-3.5">
        {items.map((o) => (
          <li key={o.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
                {o.title}
              </span>
              <span className="shrink-0 text-[10px] font-extrabold tracking-[0.08em] text-warn uppercase">
                {ACTION_LABEL[o.action]}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.45] font-medium" style={{ color: "#7A6A5C" }}>
              {o.reason}
            </p>
            <button
              type="button"
              onClick={() =>
                askCadence(`"${o.title}" didn't fit today. ${o.suggestion}`)
              }
              className="mt-2 inline-flex min-h-[38px] items-center rounded-full bg-ink px-4 text-left text-[12.5px] font-bold text-paper"
            >
              {o.suggestion}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
