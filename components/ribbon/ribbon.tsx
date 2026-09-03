"use client";

/**
 * The day ribbon. Block height is strictly proportional to duration — that is
 * the whole point, and nothing below is allowed to compromise it.
 *
 * Blocks are positioned ABSOLUTELY BY TIME rather than stacked in flow.
 *
 * The design brief describes a flow layout: "block height = max(30, duration −
 * 6) px; 6px gap". That reads identically to this for a contiguous day, but it
 * collapses empty time — a free afternoon between two blocks would render as a
 * 6px gap rather than as the four hours it is. "The user must be able to see
 * that their day is full" (SPEC §9) requires the converse to be visible too. So
 * blocks keep their absolute top, and the 6px gap falls out of drawing each one
 * 6px shorter than its span. Adjacent blocks look exactly as designed; free
 * time stays honest.
 *
 * `max(30, …)` is the one deliberate break in proportionality, taken from the
 * brief: below about 36 minutes a block cannot hold a legible title, so short
 * blocks are floored at 30px and are the only ones that read slightly large.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { blockColor, FIXED_HATCH } from "@/lib/block-color";
import { adjustBlock, setBlockStatus } from "@/app/(app)/today/actions";
import { NowLine } from "./now-line";
import { BlockSheet } from "./block-sheet";

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
  /** the task behind this block is flagged must-do-today */
  mustDoToday?: boolean;
};

export type Range = { startMin: number; endMin: number };
export type ProtectedRange = Range & { label: string };

/** 1px per minute, per the brief. */
const PX_PER_MIN = 1;
const GUTTER_PX = 44;
const SPINE_LEFT_PX = 38;
/** Vertical breathing room between adjacent blocks. */
const GAP_PX = 6;
/** Shortest a block may be drawn, even if its duration is less. */
const MIN_BLOCK_PX = 30;
/** At/above this height the reason line is shown inside the block. */
const REASON_PX = 78;
/** A resize handle is only offered when the block is at least this tall. */
const RESIZABLE_PX = 40;
/** Drag / resize snap, in minutes. */
const SNAP_MIN = 5;
/** How far the pointer must travel before a press counts as a drag, not a tap. */
const DRAG_THRESHOLD_PX = 4;
/**
 * Touch only: how long a finger must rest on a block before dragging arms.
 *
 * Without this the ribbon would have to set `touch-action: none` on every
 * block, and since blocks cover nearly the full width, the page could no longer
 * be scrolled by dragging over them. Hold to move, swipe to scroll.
 */
const LONG_PRESS_MS = 350;
/** Shortest a block can be dragged to. */
const FLOOR_MIN = 5;

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

type DragMode = "move" | "top" | "bottom";
type Gesture = {
  id: string;
  mode: DragMode;
  y0: number;
  s0: number;
  e0: number;
  moved: boolean;
  curS: number;
  curE: number;
  /** Dragging is live. Immediate for mouse/pen and for the resize handles;
   *  for a touch on the body of a block, only after the long press. */
  armed: boolean;
  timer: number | null;
};
type Draft = { startMin: number; endMin: number };

const snap = (n: number) => Math.round(n / SNAP_MIN) * SNAP_MIN;

export function Ribbon({
  windowStartMin,
  windowEndMin,
  focusRanges,
  protectedRanges,
  blocks,
  isToday,
  editable = false,
  initialWarnings = [],
  date,
  view,
}: {
  windowStartMin: number;
  windowEndMin: number;
  focusRanges: Range[];
  protectedRanges: ProtectedRange[];
  blocks: RibbonBlock[];
  isToday: boolean;
  editable?: boolean;
  initialWarnings?: string[];
  date?: string;
  view: "ribbon" | "list";
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>(initialWarnings);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  /** The block whose long press has armed, for the lifted visual. */
  const [armedId, setArmedId] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  /**
   * Suppress the browser's own scrolling only while a drag is actually armed.
   *
   * This has to be a non-passive listener added by hand: React attaches touch
   * handlers passively, so preventDefault() from a JSX onTouchMove is ignored.
   * The alternative is `touch-action: none` in CSS, which would be permanent
   * and would cost the page its scroll everywhere a block sits.
   */
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current?.armed) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  // A gesture abandoned mid-flight must not leave its long-press timer running.
  useEffect(() => {
    return () => {
      if (gesture.current?.timer != null) clearTimeout(gesture.current.timer);
    };
  }, []);

  const span = Math.max(1, windowEndMin - windowStartMin);
  const height = span * PX_PER_MIN;
  const y = (min: number) => Math.round((min - windowStartMin) * PX_PER_MIN);
  const clampTop = (min: number) => Math.max(0, Math.min(height, y(min)));

  const posOf = (b: RibbonBlock): Draft =>
    drafts[b.id] ?? { startMin: b.startMin, endMin: b.endMin };

  function onDown(e: React.PointerEvent, b: RibbonBlock) {
    if (!editable || b.kind === "break") return;
    const handle = (e.target as HTMLElement).dataset.handle as DragMode | undefined;
    const mode: DragMode = handle ?? "move";

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the gesture still works.
    }
    const p = posOf(b);

    // While a previous edit is still saving, a press may still open the block —
    // it just cannot become a second drag. Refusing the press outright made
    // blocks feel dead for the second or so after every move.
    const armNow = !saving && (e.pointerType !== "touch" || !!handle);

    gesture.current = {
      id: b.id,
      mode,
      y0: e.clientY,
      s0: p.startMin,
      e0: p.endMin,
      moved: false,
      curS: p.startMin,
      curE: p.endMin,
      armed: armNow,
      timer: null,
    };

    if (armNow) {
      setArmedId(b.id);
    } else if (!saving) {
      gesture.current.timer = window.setTimeout(() => {
        const g = gesture.current;
        if (!g || g.id !== b.id) return;
        g.armed = true;
        g.timer = null;
        setArmedId(b.id);
      }, LONG_PRESS_MS);
    }
  }

  function onDragMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.y0;

    if (!g.armed) {
      // The finger moved before the hold completed — that is a scroll, not a
      // drag. Stand down and let the page have the gesture.
      if (Math.abs(dy) > DRAG_THRESHOLD_PX) {
        if (g.timer != null) clearTimeout(g.timer);
        gesture.current = null;
        setArmedId(null);
      }
      return;
    }

    // Below the threshold a press is still a tap, so a slightly unsteady finger
    // opens the sheet instead of nudging the block by five minutes.
    if (!g.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;

    const dMin = snap(dy / PX_PER_MIN);
    if (dMin === 0 && !g.moved) return;
    g.moved = true;
    setActiveId(g.id);

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

  function pickStatus(blockId: string, next: RibbonBlock["status"]) {
    startSave(async () => {
      const res = await setBlockStatus({ date, blockId, status: next });
      if (!res.ok) {
        setWarnings([res.error]);
        return;
      }
      router.refresh();
    });
  }

  function onDragEnd() {
    const g = gesture.current;
    gesture.current = null;
    setActiveId(null);
    setArmedId(null);
    if (!g) return;
    if (g.timer != null) clearTimeout(g.timer);

    // Pressed but never dragged: that is a tap, and a tap opens the block.
    if (!g.moved) {
      setSheetFor(g.id);
      return;
    }

    const startMin = g.curS;
    const endMin = g.curE;
    startSave(async () => {
      const res = await adjustBlock({ date, blockId: g.id, startMin, endMin });
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
      router.refresh();
    });
  }

  const sheetBlock = blocks.find((b) => b.id === sheetFor) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {view === "list" ? (
        <ListView blocks={blocks} onOpen={setSheetFor} />
      ) : (
        <div
          ref={surfaceRef}
          className="relative"
          style={{ height, paddingLeft: GUTTER_PX }}
        >
          {/* the spine */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-line"
            style={{ left: SPINE_LEFT_PX }}
          />

          {/* learned focus hours — inside the spine, and absent entirely while
              there is no evidence. A default morning band is the guess this
              feature removed. */}
          {focusRanges.map((r, i) => {
            const top = clampTop(r.startMin);
            const h = clampTop(r.endMin) - top;
            if (h <= 0) return null;
            return (
              <div
                key={`focus-${i}`}
                aria-hidden
                className="pointer-events-none absolute w-[3px] rounded-full bg-primary"
                style={{ left: SPINE_LEFT_PX - 0.5, top, height: h, opacity: 0.22 }}
              />
            );
          })}

          {/* protected blocks — reserved and non-plannable, so they are labelled */}
          {protectedRanges.map((r, i) => {
            const top = clampTop(r.startMin);
            const h = clampTop(r.endMin) - top;
            if (h <= 0) return null;
            return (
              <div
                key={`prot-${i}`}
                className="pointer-events-none absolute right-0 rounded-[14px] bg-tint/60"
                style={{ left: GUTTER_PX, top, height: h }}
              >
                <span className="absolute top-1.5 left-3 text-[11px] font-bold text-ink-faint">
                  {r.label}
                </span>
              </div>
            );
          })}

          {/* Start times live in the gutter as siblings of the blocks, not
              inside them: a block is overflow-hidden for its rounded corners
              and bucket bar, which clipped a label positioned at left:-44px. */}
          {blocks.map((b) => {
            const p = posOf(b);
            return (
              <span
                key={`t-${b.id}`}
                className="tabular pointer-events-none absolute left-0 text-[11px] font-bold text-ink-faint"
                style={{ top: y(p.startMin) }}
              >
                {fmt(p.startMin)}
              </span>
            );
          })}

          {blocks.map((b) => {
            const p = posOf(b);
            const top = y(p.startMin);
            const blockH = Math.max(MIN_BLOCK_PX, y(p.endMin) - top - GAP_PX);
            const isFixed = b.kind === "fixed";
            const isBreak = b.kind === "break";
            const done = b.status === "done";
            const skipped = b.status === "skipped";
            const showReason = blockH >= REASON_PX && !!b.reason;
            const color = blockColor(b.category, b.kind);
            const dragging = activeId === b.id;
            const armed = armedId === b.id;

            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                aria-label={`${b.title}, ${fmt(p.startMin)} to ${fmt(p.endMin)}, ${b.status}`}
                onPointerDown={editable ? (e) => onDown(e, b) : undefined}
                onPointerMove={editable ? onDragMove : undefined}
                onPointerUp={editable ? onDragEnd : undefined}
                onPointerCancel={editable ? onDragEnd : undefined}
                {...(editable ? {} : { onClick: () => setSheetFor(b.id) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSheetFor(b.id);
                  }
                }}
                className={cn(
                  "absolute right-0 flex overflow-hidden rounded-[18px] text-left",
                  dragging || armed ? "z-40" : "z-10",
                  done ? "opacity-[.74]" : skipped ? "opacity-60" : "shadow-card",
                  editable && !isBreak && "cursor-grab",
                  dragging && "cursor-grabbing",
                )}
                style={{
                  left: GUTTER_PX,
                  top,
                  height: blockH,
                  background: done ? "#F6F1E7" : "var(--color-surface)",
                  // Lifted while the drag is live, so a long press on a phone
                  // visibly confirms it took before the finger moves.
                  boxShadow: dragging || armed ? "var(--shadow-open)" : undefined,
                  transform: dragging || armed ? "scale(1.015)" : undefined,
                  transition: dragging ? "none" : "transform 120ms ease-out",
                }}
              >
                {/* the bucket bar */}
                <span
                  aria-hidden
                  className="h-full w-[5px] shrink-0"
                  style={{ background: isFixed ? FIXED_HATCH : color }}
                />

                <div className="min-w-0 flex-1 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate font-bold tracking-[-0.015em]",
                        blockH >= 60 ? "text-[15.5px]" : "text-[14px]",
                        done ? "text-ink-ghost line-through" : "text-ink",
                      )}
                    >
                      {b.title}
                    </span>
                    <span
                      className="tabular shrink-0 text-[11.5px] font-extrabold"
                      style={{ color: isBreak ? "var(--color-ink-faint)" : color }}
                    >
                      {dur(p.endMin - p.startMin)}
                    </span>
                  </div>

                  <p
                    className={cn(
                      "truncate text-[11.5px] font-semibold",
                      b.mustDoToday && b.status === "planned"
                        ? "text-warn"
                        : "text-ink-faint",
                    )}
                  >
                    {b.mustDoToday && b.status === "planned" ? "Must do today · " : ""}
                    {fmt(p.startMin)}–{fmt(p.endMin)}
                    {b.status !== "planned" ? ` · ${b.status}` : ""}
                  </p>

                  {showReason ? (
                    <p
                      className="mt-1 text-[12.5px] leading-[1.4] font-medium text-ink-soft"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {b.reason}
                    </p>
                  ) : null}
                </div>

                {editable && !isBreak && blockH >= RESIZABLE_PX ? (
                  <>
                    <span
                      data-handle="top"
                      className="absolute inset-x-0 top-0 z-20 h-2 cursor-ns-resize"
                    />
                    <span
                      data-handle="bottom"
                      className="absolute inset-x-0 bottom-0 z-20 h-2 cursor-ns-resize"
                    />
                  </>
                ) : null}
              </div>
            );
          })}

          {isToday ? (
            <NowLine
              windowStartMin={windowStartMin}
              windowEndMin={windowEndMin}
              pxPerMin={PX_PER_MIN}
              spineLeftPx={SPINE_LEFT_PX}
            />
          ) : null}
        </div>
      )}

      {view === "ribbon" ? (
        <p className="text-[11.5px] font-semibold text-ink-faint">
          Height is duration. Tap a block for the reasoning
          {editable ? ", hold and drag to move it, or pull its edges to resize" : ""}.
        </p>
      ) : null}

      {editable && warnings.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">
            Saved. These checks now fail — your call:
          </p>
          <ul className="list-disc pl-4 text-[12.5px] font-medium text-ink-muted">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {editable && !warnings.length && saving ? (
        <p className="text-[12px] font-semibold text-ink-faint">Saving…</p>
      ) : null}

      <BlockSheet
        block={sheetBlock}
        open={!!sheetBlock}
        onClose={() => setSheetFor(null)}
        onPick={(next) => sheetBlock && pickStatus(sheetBlock.id, next)}
        saving={saving}
        canLog={editable}
      />
    </div>
  );
}

/** Same data, no proportionality — for when the day is long and you want it dense. */
function ListView({
  blocks,
  onOpen,
}: {
  blocks: RibbonBlock[];
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {blocks.map((b) => {
        const done = b.status === "done";
        return (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onOpen(b.id)}
              aria-label={`${b.title}, ${fmt(b.startMin)} to ${fmt(b.endMin)}, ${b.status}`}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-3 text-left",
                done ? "opacity-[.74]" : "shadow-card",
              )}
              style={{ background: done ? "#F6F1E7" : "var(--color-surface)" }}
            >
              <span className="tabular w-11 shrink-0 text-[12px] font-bold text-ink-faint">
                {fmt(b.startMin)}
              </span>
              <span
                aria-hidden
                className="block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: blockColor(b.category, b.kind) }}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[14px] font-bold",
                    done ? "text-ink-ghost line-through" : "text-ink",
                  )}
                >
                  {b.title}
                </span>
                <span className="block truncate text-[11px] font-semibold text-ink-faint">
                  {b.status !== "planned" ? `${b.status} · ` : ""}
                  {b.reason || `${fmt(b.startMin)}–${fmt(b.endMin)}`}
                </span>
              </span>
              <span className="tabular shrink-0 rounded-full bg-tint px-2.5 py-1 text-[11px] font-bold text-ink-muted">
                {dur(b.endMin - b.startMin)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
