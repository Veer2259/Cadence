"use client";

import { useEffect, useState } from "react";

/** Minutes since midnight, right now, in IST — read from the browser clock. */
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

/**
 * The moving current-time hairline. A 1px --ink rule across the ribbon with the
 * time in mono in the left gutter. Re-reads the clock every 30s.
 */
export function NowLine({
  windowStartMin,
  windowEndMin,
  pxPerMin,
  gutterPx,
}: {
  windowStartMin: number;
  windowEndMin: number;
  pxPerMin: number;
  gutterPx: number;
}) {
  // Starts null so server and client render the same HTML; the real clock value
  // is read only after mount (this component is SSR'd as part of the page).
  const [nowMin, setNowMin] = useState<number | null>(null);

  useEffect(() => {
    // Seed the client-only clock value once on mount, then tick it every 30s.
    const read = () => setNowMin(istNowMinutes());
    read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  }, []);

  if (nowMin == null || nowMin < windowStartMin || nowMin > windowEndMin) return null;

  const top = (nowMin - windowStartMin) * pxPerMin;
  const hh = String(Math.floor(nowMin / 60)).padStart(2, "0");
  const mm = String(nowMin % 60).padStart(2, "0");

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
      style={{ top }}
    >
      <span
        className="tabular -translate-y-1/2 bg-paper pr-1 text-[11px] text-ink"
        style={{ width: gutterPx, textAlign: "right" }}
      >
        {hh}:{mm}
      </span>
      <span className="h-px flex-1 bg-ink" />
    </div>
  );
}
