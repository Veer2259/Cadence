"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AccuracyPoint, BucketHours } from "@/lib/review";
import { SHARP_THRESHOLD, type HourBucket } from "@/lib/energy";

const AXIS = { fontSize: 11, fontFamily: "var(--font-mono)", fill: "var(--color-ink-muted)" };
const GRID = "var(--color-rule)";

export function AccuracyChart({ data }: { data: AccuracyPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No debriefed days yet — this chart fills in as you log actuals.
      </p>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={(d: string) => d.slice(5)} stroke={GRID} />
          <YAxis tick={AXIS} stroke={GRID} domain={[0, "auto"]} width={40} />
          <ReferenceLine y={1} stroke="var(--color-settled)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              border: "1px solid var(--color-rule)",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
            formatter={(v) => [`${v}×`, "actual / estimate"]}
          />
          <Line
            type="monotone"
            dataKey="ratio"
            stroke="var(--color-ink)"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "var(--color-ink)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BucketChart({ data }: { data: BucketHours[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-ink-muted">No time logged in the last 30 days.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="bucket" tick={AXIS} stroke={GRID} />
          <YAxis tick={AXIS} stroke={GRID} width={40} unit="h" />
          <Tooltip
            contentStyle={{
              border: "1px solid var(--color-rule)",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
            formatter={(v, n) => [`${v}h`, n === "hours7" ? "last 7d" : "last 30d"]}
          />
          <Bar dataKey="hours30" fill="var(--color-rule)" />
          <Bar dataKey="hours7" fill="var(--color-ink)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Mean energy per hour of day. The dashed line is the threshold a hour has to
 * clear to count as "sharp" in the Settings suggestion — so the chart shows the
 * suggestion's own reasoning rather than asking you to trust it.
 */
export function EnergyByHourChart({ data }: { data: HourBucket[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No energy logged yet. Use the check-in on Today — it takes one tap, and a
        few days of it is enough to see a shape.
      </p>
    );
  }
  const rows = data.map((d) => ({
    ...d,
    label: `${String(d.hour).padStart(2, "0")}:00`,
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} stroke={GRID} />
          <YAxis
            tick={AXIS}
            stroke={GRID}
            width={52}
            domain={[0, 2]}
            ticks={[0, 1, 2]}
            tickFormatter={(v) => ["fried", "ok", "sharp"][Number(v)] ?? ""}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid var(--color-rule)",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
            formatter={(v, _n, item) => {
              const p = item?.payload as HourBucket | undefined;
              const mean = Number(v).toFixed(2);
              return [`${mean} (${p?.n ?? 0} samples, ${p?.days ?? 0} days)`, "mean energy"];
            }}
          />
          <ReferenceLine
            y={SHARP_THRESHOLD}
            stroke="var(--color-ink-muted)"
            strokeDasharray="3 3"
          />
          <Bar dataKey="mean" fill="var(--color-ink)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
