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
 * The moving current-time marker: an emerald dot on the spine with the time in
 * the gutter and a faint rule running right. Re-reads the clock every 30s.
 */
export function NowLine({
  windowStartMin,
  windowEndMin,
  pxPerMin,
  spineLeftPx,
}: {
  windowStartMin: number;
  windowEndMin: number;
  pxPerMin: number;
  spineLeftPx: number;
}) {
  // Starts null so server and client render the same HTML.
  const [nowMin, setNowMin] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setNowMin(istNowMinutes());
    read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  }, []);

  if (nowMin == null || nowMin < windowStartMin || nowMin > windowEndMin) return null;

  const top = (nowMin - windowStartMin) * pxPerMin + 4;
  const hh = String(Math.floor(nowMin / 60)).padStart(2, "0");
  const mm = String(nowMin % 60).padStart(2, "0");

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-30"
      style={{ top }}
      aria-hidden
    >
      <span className="tabular absolute top-0 left-0 -translate-y-1/2 text-[10px] font-extrabold text-primary">
        {hh}:{mm}
      </span>
      <span
        className="absolute h-3 w-3 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: spineLeftPx - 5, boxShadow: "0 0 0 3px var(--color-paper)" }}
      />
      <span
        className="absolute right-0 h-0.5 -translate-y-1/2 bg-primary"
        style={{ left: spineLeftPx + 10, opacity: 0.35 }}
      />
    </div>
  );
}
