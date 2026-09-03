"use client";

/**
 * The block detail sheet: the full reason, and the three status controls.
 *
 * Tapping the active status again clears it back to planned, which is the only
 * way to undo a mis-tap. The controls were previously ON the block, which
 * worked but cost the ribbon a lot of vertical room on short blocks and forced
 * a separate pinned-menu path for slivers. One sheet serves every block height.
 */

import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { blockColor } from "@/lib/block-color";
import type { RibbonBlock } from "./ribbon";

const OPTIONS = [
  { key: "done", label: "Done", cls: "bg-primary text-white" },
  { key: "partial", label: "Partial", cls: "bg-caution text-white" },
  { key: "skipped", label: "Skipped", cls: "bg-warn text-white" },
] as const;

const hm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

export function BlockSheet({
  block,
  open,
  onClose,
  onPick,
  saving,
  canLog,
}: {
  block: RibbonBlock | null;
  open: boolean;
  onClose: () => void;
  onPick: (next: RibbonBlock["status"]) => void;
  saving: boolean;
  canLog: boolean;
}) {
  if (!block) return null;

  return (
    <Sheet open={open} onClose={onClose} title={block.title} maxHeight="72%">
      <div className="px-5 pt-1 pb-8">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="block h-2.5 w-2.5 rounded-full"
            style={{ background: blockColor(block.category, block.kind) }}
          />
          <p className="tabular text-[12.5px] font-bold text-ink-soft">
            {hm(block.startMin)}–{hm(block.endMin)} · {block.endMin - block.startMin}m ·{" "}
            {block.category}
          </p>
        </div>

        {block.mustDoToday ? (
          <p className="mt-2.5 inline-block rounded-full bg-warn-tint px-2.5 py-1 text-[10px] font-extrabold tracking-[0.08em] text-warn uppercase">
            Must do today
          </p>
        ) : null}

        {block.reason ? (
          <p className="mt-3 text-[14.5px] leading-[1.5] font-medium text-ink-muted">
            {block.reason}
          </p>
        ) : null}

        {canLog ? (
          <>
            <p className="mt-5 text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
              How did it go?
            </p>
            <div className="mt-2 flex gap-2">
              {OPTIONS.map((o) => {
                const active = block.status === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    disabled={saving}
                    aria-pressed={active}
                    onClick={() => onPick(active ? "planned" : o.key)}
                    title={active ? `${o.label} — tap again to clear` : `Mark ${o.label}`}
                    className={cn(
                      "min-h-[42px] flex-1 rounded-full text-[13px] font-extrabold disabled:opacity-60",
                      active ? o.cls : "bg-tint text-ink-soft",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11.5px] font-medium text-ink-faint">
              Tap the active one again to clear it back to planned.
            </p>
          </>
        ) : (
          <p className="mt-5 text-[12.5px] font-semibold text-ink-faint">
            This day is a record — nothing here can be changed.
          </p>
        )}
      </div>
    </Sheet>
  );
}
