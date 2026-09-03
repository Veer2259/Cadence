"use client";

import { useState } from "react";
import { Labeled, Select, Input } from "@/components/ui/controls";
import type { HabitCadence } from "@/lib/habits";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/time";

/**
 * Structured cadence input. Emits a hidden `cadence` field holding the
 * HabitCadence as JSON, so the Server Action just JSON.parses it.
 */
export function CadencePicker({ initial }: { initial?: HabitCadence }) {
  const [kind, setKind] = useState<HabitCadence["kind"]>(initial?.kind ?? "per_week");
  const [count, setCount] = useState<number>(
    initial?.kind === "per_week" ? initial.count : 3,
  );
  const [days, setDays] = useState<WeekdayKey[]>(
    initial?.kind === "days" ? initial.days : ["mon", "wed", "fri"],
  );

  const value: HabitCadence =
    kind === "daily"
      ? { kind: "daily" }
      : kind === "days"
        ? { kind: "days", days: WEEKDAY_KEYS.filter((d) => days.includes(d)) }
        : { kind: "per_week", count };

  function toggleDay(d: WeekdayKey) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="cadence" value={JSON.stringify(value)} />
      <Labeled label="Cadence">
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as HabitCadence["kind"])}
          className="w-40"
        >
          <option value="daily">Every day</option>
          <option value="per_week">N times a week</option>
          <option value="days">Specific days</option>
        </Select>
      </Labeled>

      {kind === "per_week" ? (
        <Labeled label="Times / week">
          <Input
            type="number"
            min={1}
            max={7}
            value={count}
            onChange={(e) =>
              setCount(Math.min(7, Math.max(1, Number(e.target.value) || 1)))
            }
            className="w-20"
          />
        </Labeled>
      ) : null}

      {kind === "days" ? (
        <div className="flex flex-wrap gap-1 pb-1">
          {WEEKDAY_KEYS.map((d) => (
            <label
              key={d}
              className="flex cursor-pointer items-center gap-1 border border-line px-1.5 py-1 text-xs text-ink-muted"
              style={{ borderRadius: "var(--radius-card)" }}
            >
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={() => toggleDay(d)}
              />
              {d}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
