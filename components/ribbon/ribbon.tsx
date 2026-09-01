import { cn } from "@/lib/cn";
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
}: {
  block: RibbonBlock;
  tight: boolean;
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
        {fmt(block.startMin)}–{fmt(block.endMin)} · {dur(block.endMin - block.startMin)}
      </span>
    </div>
  );
}

export function Ribbon({
  windowStartMin,
  windowEndMin,
  workRanges,
  sharpRanges,
  protectedRanges,
  blocks,
  isToday,
}: {
  windowStartMin: number;
  windowEndMin: number;
  workRanges: Range[];
  sharpRanges: Range[];
  protectedRanges: ProtectedRange[];
  blocks: RibbonBlock[];
  isToday: boolean;
}) {
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

  // No `overflow-hidden` on the root — it would clip the blocks' hover/focus
  // reason popover. clampBand/clampTop already keep every background layer
  // strictly inside [0, height], and each is pointer-events-none besides.
  return (
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
        <div key={`h-${h}`} className="pointer-events-none absolute right-0 left-0 flex items-start" style={{ top: clampTop(h * 60) }}>
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
        const blockHeight = Math.max(6, bandHeight(b.startMin, b.endMin));
        const micro = blockHeight < MICRO_PX;
        const tight = blockHeight < TIGHT_PX;
        const inlineReason = blockHeight >= INLINE_REASON_PX && !!b.reason;
        const comfortable = blockHeight >= COMFORTABLE_REASON_PX;
        const isFixed = b.kind === "fixed";
        const isBreak = b.kind === "break";
        return (
          <div
            key={b.id}
            tabIndex={0}
            className={cn(
              "group absolute right-1 z-10 border px-2 hover:z-30 focus:z-30",
              tight ? "py-0" : comfortable ? "py-1" : "py-0.5",
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
              top: y(b.startMin),
              height: blockHeight,
              borderRadius: "var(--radius)",
              background: isFixed
                ? "repeating-linear-gradient(45deg, var(--color-surface) 0 6px, var(--color-paper) 6px 12px)"
                : isBreak
                  ? "var(--color-paper)"
                  : "var(--color-surface)",
            }}
          >
            {/* inline content, clipped to the proportional box */}
            <div className="h-full overflow-hidden">
              {micro ? null : <BlockHeader block={b} tight={tight} />}
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

            {/* full untruncated reason on hover / focus — works for every block,
                and is the only place a very short block's reason can be read */}
            {b.reason ? (
              <div className="absolute top-full right-1 left-0 z-40 mt-0.5 hidden border border-ink bg-surface px-2 py-1.5 group-hover:block group-focus:block group-focus-within:block">
                <BlockHeader block={b} tight={false} />
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
  );
}
