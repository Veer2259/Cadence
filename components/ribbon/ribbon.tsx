"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { adjustBlock } from "@/app/(app)/today/actions";
import { NowLine } from "./now-line";

export type RibbonBlock = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  kind: "task" | "fixed" | "habit" | "break";
  category: string;
  reason: string;
  estimateMin: number;
  status: "planned" | "done" | "partial" | "skipped";
};

export type Range = { startMin: number; endMin: number };
export type ProtectedRange = Range & { label: string };

const PX_PER_MIN = 1.25;
const GUTTER_PX = 46;
/** Drag / resize snap, in minutes. */
const SNAP_MIN = 5;
/** Shortest a block can be dragged to. The planner's own minimum is higher, but
 *  a manual edit is the user overriding the planner, so only stop at absurd. */
const FLOOR_MIN = 5;
/** At/above this height a block shows a reason line inline (smaller type between
 *  here and COMFORTABLE_REASON_PX). Below it, the reason is hover/focus only.
 *  Every block, at every height, exposes the full reason on hover/focus. */
const INLINE_REASON_PX = 26;
/** At/above this height the inline reason gets comfortable type + spacing. */
const COMFORTABLE_REASON_PX = 44;
/** Below this height the header text shrinks so it still fits the proportional box. */
const TIGHT_PX = 26;
/** Below this height nothing legible fits — render a bare sliver; the title and
 *  reason are still on the hover/focus panel. */
const MICRO_PX = 16;
/** A resize handle is only offered when the block is at least this tall. */
const RESIZABLE_PX = 26;

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${String(m).padStart(2, "0")}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function BlockHeader({
  block,
  tight,
  atMin,
  toMin,
}: {
  block: RibbonBlock;
  tight: boolean;
  atMin: number;
  toMin: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span
        className={cn(
          "truncate",
          tight ? "text-[11px]" : "text-[13px]",
          block.kind === "break" ? "text-ink-muted" : "text-ink",
        )}
      >
        {block.title}
      </span>
      <span className="tabular shrink-0 text-[11px] text-ink-muted">
        {fmt(atMin)}–{fmt(toMin)} · {dur(toMin - atMin)}
      </span>
    </div>
  );
}

type DragMode = "move" | "top" | "bottom";
type Gesture = {
  id: string;
  mode: DragMode;
  y0: number;
  s0: number;
  e0: number;
  moved: boolean;
  /** latest computed position — the ref is the source of truth on drop, since
   *  React state (`drafts`) may not have flushed the final pointermove yet. */
  curS: number;
  curE: number;
};
type Draft = { startMin: number; endMin: number };

const snap = (n: number) => Math.round(n / SNAP_MIN) * SNAP_MIN;

export function Ribbon({
  windowStartMin,
  windowEndMin,
  workRanges,
  sharpRanges,
  protectedRanges,
  blocks,
  isToday,
  editable = false,
  initialWarnings = [],
}: {
  windowStartMin: number;
  windowEndMin: number;
  workRanges: Range[];
  sharpRanges: Range[];
  protectedRanges: ProtectedRange[];
  blocks: RibbonBlock[];
  isToday: boolean;
  /** When true, blocks can be dragged to move / resize; drops re-run the checks. */
  editable?: boolean;
  /** Geometry violations the plan already has on load (from a prior manual edit). */
  initialWarnings?: string[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>(initialWarnings);
  const [saving, startSave] = useTransition();
  const gesture = useRef<Gesture | null>(null);

  const span = Math.max(1, windowEndMin - windowStartMin);
  const height = span * PX_PER_MIN;
  // Rounded to whole pixels so consecutive blocks share an exact edge (no
  // sub-pixel gap or overlap) while staying strictly proportional.
  const y = (min: number) => Math.round((min - windowStartMin) * PX_PER_MIN);
  const bandHeight = (a: number, b: number) => y(b) - y(a);
  // Background bands must never escape the ribbon box: a negative `top` would
  // paint the band over the page controls above the ribbon (and, being opaque,
  // swallow their clicks). Callers already size the window to include every
  // range, but clamp here too so a stray range can't reach outside.
  const clampTop = (min: number) => Math.max(0, Math.min(height, y(min)));
  const clampBand = (a: number, b: number) => {
    const top = clampTop(a);
    return { top, height: Math.max(0, clampTop(b) - top) };
  };

  const firstHour = Math.ceil(windowStartMin / 60);
  const lastHour = Math.floor(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  const posOf = (b: RibbonBlock): Draft =>
    drafts[b.id] ?? { startMin: b.startMin, endMin: b.endMin };

  function onDown(e: React.PointerEvent, b: RibbonBlock) {
    if (!editable || b.kind === "break" || saving) return;
    const handle = (e.target as HTMLElement).dataset.handle as DragMode | undefined;
    const mode: DragMode = handle ?? "move";
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = posOf(b);
    gesture.current = {
      id: b.id,
      mode,
      y0: e.clientY,
      s0: p.startMin,
      e0: p.endMin,
      moved: false,
      curS: p.startMin,
      curE: p.endMin,
    };
    setActiveId(b.id);
  }

  function onDragMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dMin = snap((e.clientY - g.y0) / PX_PER_MIN);
    if (dMin === 0 && !g.moved) return;
    g.moved = true;

    let s = g.s0;
    let en = g.e0;
    if (g.mode === "move") {
      s = g.s0 + dMin;
      en = g.e0 + dMin;
      if (s < 0) {
        en -= s;
        s = 0;
      }
      if (en > 1440) {
        s -= en - 1440;
        en = 1440;
      }
    } else if (g.mode === "top") {
      s = Math.max(0, Math.min(g.e0 - FLOOR_MIN, g.s0 + dMin));
    } else {
      en = Math.min(1440, Math.max(g.s0 + FLOOR_MIN, g.e0 + dMin));
    }
    g.curS = s;
    g.curE = en;
    setDrafts((d) => ({ ...d, [g.id]: { startMin: s, endMin: en } }));
  }

  function onDragEnd() {
    const g = gesture.current;
    gesture.current = null;
    setActiveId(null);
    if (!g || !g.moved) return;
    const startMin = g.curS;
    const endMin = g.curE;
    startSave(async () => {
      const res = await adjustBlock({ blockId: g.id, startMin, endMin });
      if (!res.ok) {
        setDrafts((cur) => {
          const n = { ...cur };
          delete n[g.id];
          return n;
        });
        setWarnings([res.error]);
        return;
      }
      setWarnings(res.violations);
      // Keep the local override (it now equals the saved row) and pull the
      // authoritative state in — the two agree, so there is no flicker.
      router.refresh();
    });
  }

  // No `overflow-hidden` on the root — it would clip the blocks' hover/focus
  // reason popover. clampBand/clampTop already keep every background layer
  // strictly inside [0, height], and each is pointer-events-none besides.
  return (
    <div className="flex flex-col gap-3">
      <div className="relative" style={{ height, paddingLeft: GUTTER_PX }}>
        {/* body */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 border border-rule bg-paper"
          style={{ left: GUTTER_PX }}
        />

        {/* in-window working ranges get the surface fill; gaps stay paper */}
        {workRanges.map((r, i) => (
          <div
            key={`work-${i}`}
            className="pointer-events-none absolute right-0 bg-surface"
            style={{ left: GUTTER_PX, ...clampBand(r.startMin, r.endMin) }}
          />
        ))}

        {/* sharp-hours band — full width so it reads even when blocks are packed */}
        {sharpRanges.map((r, i) => (
          <div
            key={`sharp-${i}`}
            className="pointer-events-none absolute right-0 left-0"
            style={{
              ...clampBand(r.startMin, r.endMin),
              background: "var(--color-sharp)",
            }}
          />
        ))}

        {/* protected blocks — reserved, non-plannable; visible and labelled */}
        {protectedRanges.map((r, i) => (
          <div
            key={`prot-${i}`}
            className="pointer-events-none absolute right-0 z-[5] border-y border-rule/70"
            style={{
              left: GUTTER_PX,
              ...clampBand(r.startMin, r.endMin),
              background: "color-mix(in srgb, var(--color-rule) 32%, var(--color-paper))",
            }}
          >
            <span className="absolute top-0.5 left-1.5 bg-paper/90 px-1 text-[11px] text-ink-muted">
              {r.label}
            </span>
          </div>
        ))}

        {/* hour rules + gutter labels */}
        {hours.map((h) => (
          <div
            key={`h-${h}`}
            className="pointer-events-none absolute right-0 left-0 flex items-start"
            style={{ top: clampTop(h * 60) }}
          >
            <span
              className="tabular -translate-y-1/2 pr-2 text-[11px] text-ink-muted"
              style={{ width: GUTTER_PX, textAlign: "right" }}
            >
              {String(h % 24).padStart(2, "0")}:00
            </span>
            <span className="h-px flex-1 bg-rule" />
          </div>
        ))}

        {/* blocks */}
        {blocks.map((b) => {
          const p = posOf(b);
          const blockHeight = Math.max(6, bandHeight(p.startMin, p.endMin));
          const micro = blockHeight < MICRO_PX;
          const tight = blockHeight < TIGHT_PX;
          const inlineReason = blockHeight >= INLINE_REASON_PX && !!b.reason;
          const comfortable = blockHeight >= COMFORTABLE_REASON_PX;
          const isFixed = b.kind === "fixed";
          const isBreak = b.kind === "break";
          const canDrag = editable && !isBreak;
          const dragging = activeId === b.id;
          return (
            <div
              key={b.id}
              tabIndex={0}
              onPointerDown={canDrag ? (e) => onDown(e, b) : undefined}
              onPointerMove={canDrag ? onDragMove : undefined}
              onPointerUp={canDrag ? onDragEnd : undefined}
              onPointerCancel={canDrag ? onDragEnd : undefined}
              className={cn(
                "group absolute right-1 z-10 border px-2 hover:z-30 focus:z-30",
                tight ? "py-0" : comfortable ? "py-1" : "py-0.5",
                canDrag && "cursor-grab touch-none",
                dragging && "z-40 cursor-grabbing border-ink",
                isBreak
                  ? "border-dashed border-rule"
                  : b.status === "skipped"
                    ? "border-rule opacity-60"
                    : b.status === "done"
                      ? "border-settled"
                      : "border-ink/25",
              )}
              style={{
                left: GUTTER_PX + 4,
                top: y(p.startMin),
                height: blockHeight,
                borderRadius: "var(--radius)",
                background: isFixed
                  ? "repeating-linear-gradient(45deg, var(--color-surface) 0 6px, var(--color-paper) 6px 12px)"
                  : isBreak
                    ? "var(--color-paper)"
                    : "var(--color-surface)",
              }}
            >
              {canDrag && blockHeight >= RESIZABLE_PX ? (
                <>
                  <span
                    data-handle="top"
                    className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize"
                  />
                  <span
                    data-handle="bottom"
                    className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-ns-resize"
                  />
                </>
              ) : null}

              {/* inline content, clipped to the proportional box */}
              <div className="h-full overflow-hidden">
                {micro ? null : (
                  <BlockHeader block={b} tight={tight} atMin={p.startMin} toMin={p.endMin} />
                )}
                {inlineReason ? (
                  <p
                    className={cn(
                      "judgment truncate text-ink-muted",
                      comfortable ? "mt-0.5 text-[12px] leading-snug" : "text-[10px] leading-none",
                    )}
                  >
                    {b.reason}
                  </p>
                ) : null}
              </div>

              {/* full untruncated reason on hover / focus — hidden while this
                  block is being dragged */}
              {b.reason && !dragging ? (
                <div className="absolute top-full right-1 left-0 z-40 mt-0.5 hidden border border-ink bg-surface px-2 py-1.5 group-hover:block group-focus:block group-focus-within:block">
                  <BlockHeader block={b} tight={false} atMin={p.startMin} toMin={p.endMin} />
                  <p className="judgment mt-0.5 text-[12px] leading-snug text-ink-muted">
                    {b.reason}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}

        {isToday ? (
          <NowLine
            windowStartMin={windowStartMin}
            windowEndMin={windowEndMin}
            pxPerMin={PX_PER_MIN}
            gutterPx={GUTTER_PX}
          />
        ) : null}
      </div>

      {editable && warnings.length ? (
        <div
          className="border border-caution/50 bg-surface p-3 text-xs text-ink"
          style={{ borderRadius: "var(--radius)" }}
        >
          <p className="mb-1 font-medium text-caution">
            Saved. These checks now fail — your call:
          </p>
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {editable && !warnings.length && saving ? (
        <p className="text-xs text-ink-muted">Saving…</p>
      ) : null}
    </div>
  );
}
