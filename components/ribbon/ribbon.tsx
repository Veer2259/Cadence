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

const PX_PER_MIN = 1.25;
const GUTTER_PX = 46;
const MIN_LABEL_HEIGHT = 46; // below this, hide the reason line

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

export function Ribbon({
  windowStartMin,
  windowEndMin,
  workRanges,
  sharpRanges,
  blocks,
  isToday,
}: {
  windowStartMin: number;
  windowEndMin: number;
  workRanges: Range[];
  sharpRanges: Range[];
  blocks: RibbonBlock[];
  isToday: boolean;
}) {
  const span = Math.max(1, windowEndMin - windowStartMin);
  const height = span * PX_PER_MIN;
  const y = (min: number) => (min - windowStartMin) * PX_PER_MIN;

  const firstHour = Math.ceil(windowStartMin / 60);
  const lastHour = Math.floor(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  return (
    <div className="relative" style={{ height, paddingLeft: GUTTER_PX }}>
      {/* body */}
      <div
        className="absolute inset-y-0 right-0 border border-rule bg-paper"
        style={{ left: GUTTER_PX }}
      />

      {/* in-window working ranges get the surface fill; gaps stay paper */}
      {workRanges.map((r, i) => (
        <div
          key={`work-${i}`}
          className="absolute right-0 bg-surface"
          style={{ left: GUTTER_PX, top: y(r.startMin), height: (r.endMin - r.startMin) * PX_PER_MIN }}
        />
      ))}

      {/* sharp-hours band — full width so it reads even when blocks are packed */}
      {sharpRanges.map((r, i) => (
        <div
          key={`sharp-${i}`}
          className="absolute right-0 left-0"
          style={{
            top: y(r.startMin),
            height: (r.endMin - r.startMin) * PX_PER_MIN,
            background: "var(--color-sharp)",
          }}
        />
      ))}

      {/* hour rules + gutter labels */}
      {hours.map((h) => (
        <div key={`h-${h}`} className="absolute right-0 left-0 flex items-start" style={{ top: y(h * 60) }}>
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
        const blockHeight = Math.max(6, (b.endMin - b.startMin) * PX_PER_MIN);
        const showReason = blockHeight >= MIN_LABEL_HEIGHT && b.reason;
        const isFixed = b.kind === "fixed";
        return (
          <div
            key={b.id}
            className={cn(
              "absolute right-1 z-10 overflow-hidden border px-2 py-1",
              b.status === "skipped" ? "border-rule opacity-60" : "border-ink/25",
              b.status === "done" && "border-settled",
            )}
            style={{
              left: GUTTER_PX + 4,
              top: y(b.startMin),
              height: blockHeight,
              borderRadius: "var(--radius)",
              background: isFixed
                ? "repeating-linear-gradient(45deg, var(--color-surface) 0 6px, var(--color-paper) 6px 12px)"
                : "var(--color-surface)",
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] text-ink">{b.title}</span>
              <span className="tabular shrink-0 text-[11px] text-ink-muted">
                {fmt(b.startMin)}–{fmt(b.endMin)} · {dur(b.endMin - b.startMin)}
              </span>
            </div>
            {showReason ? (
              <p className="judgment mt-0.5 truncate text-[12px] leading-snug text-ink-muted">
                {b.reason}
              </p>
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
