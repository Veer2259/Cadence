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
