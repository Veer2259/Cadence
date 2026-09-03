"use client";

import { useActionState, useMemo, useState } from "react";
import { saveDayProfile, type FormResult } from "@/app/(app)/settings/actions";
import { Button, Input, Labeled } from "@/components/ui/controls";
import { textToWindows, windowsToText, type Win } from "./windows";

const INITIAL: FormResult = { ok: true, errors: [] };

const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;

type DayKey = (typeof DAYS)[number][0];
type Weekly = Record<DayKey, Win[]>;
type ProtectedBlock = { label: string; start: string; end: string };

export type DayProfileFormValue = {
  workWindows: Partial<Weekly>;
  dailyCapMin: number;
  minBlockMin: number;
  maxBlockMin: number;
  breakMin: number;
  protectedBlocks: ProtectedBlock[];
};

function toTextMap(w: Partial<Weekly>): Record<DayKey, string> {
  return Object.fromEntries(
    DAYS.map(([k]) => [k, windowsToText(w[k])]),
  ) as Record<DayKey, string>;
}

export function DayProfileForm({ initial }: { initial: DayProfileFormValue }) {
  const [state, formAction, pending] = useActionState(saveDayProfile, INITIAL);

  const [work, setWork] = useState<Record<DayKey, string>>(() =>
    toTextMap(initial.workWindows),
  );
  const [blocks, setBlocks] = useState<ProtectedBlock[]>(initial.protectedBlocks);

  const parsed = useMemo(() => {
    const problems: string[] = [];
    const workOut: Partial<Weekly> = {};
    for (const [k, label] of DAYS) {
      const w = textToWindows(work[k]);
      if (w.error) problems.push(`${label} work — ${w.error}`);
      else workOut[k] = w.windows;
    }
    return { problems, workOut };
  }, [work]);

  const clientErrors = parsed.problems;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="workWindows" value={JSON.stringify(parsed.workOut)} />
      <input
        type="hidden"
        name="protectedBlocks"
        value={JSON.stringify(
          blocks.filter((b) => b.label.trim() && b.start && b.end),
        )}
      />

      <div>
        <h3 className="text-sm font-medium text-ink">Work windows</h3>
        <p className="mt-1 text-xs text-ink-muted">
          One or more ranges per day, comma-separated. Example:{" "}
          <span className="tabular">09:00-13:00, 14:00-20:00</span>. Sharp hours
          are when you think most clearly — deep work gets placed there.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="py-1 pr-3 font-medium">Day</th>
                <th className="py-1 pr-3 font-medium">Work windows</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map(([k, label]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-ink-muted">{label}</td>
                  <td className="py-1.5 pr-3">
                    <Input
                      value={work[k]}
                      onChange={(e) => setWork({ ...work, [k]: e.target.value })}
                      placeholder="—"
                      className="tabular w-full min-w-[13rem]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Labeled label="Daily cap (min)" hint="Hard ceiling, classes included">
          <Input
            name="dailyCapMin"
            type="number"
            min={30}
            max={1440}
            step={15}
            defaultValue={initial.dailyCapMin}
            className="w-28"
          />
        </Labeled>
        <Labeled label="Min block (min)">
          <Input
            name="minBlockMin"
            type="number"
            min={5}
            max={240}
            step={5}
            defaultValue={initial.minBlockMin}
            className="w-28"
          />
        </Labeled>
        <Labeled label="Max block (min)">
          <Input
            name="maxBlockMin"
            type="number"
            min={15}
            max={600}
            step={5}
            defaultValue={initial.maxBlockMin}
            className="w-28"
          />
        </Labeled>
        <Labeled label="Break (min)" hint="Between consecutive deep blocks">
          <Input
            name="breakMin"
            type="number"
            min={0}
            max={120}
            step={5}
            defaultValue={initial.breakMin}
            className="w-28"
          />
        </Labeled>
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink">Protected blocks</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Recurring non-negotiables — meals, family, sleep. Never scheduled over.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {blocks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={b.label}
                onChange={(e) => {
                  const next = [...blocks];
                  next[i] = { ...b, label: e.target.value };
                  setBlocks(next);
                }}
                placeholder="label"
                className="w-40"
              />
              <Input
                type="time"
                value={b.start}
                onChange={(e) => {
                  const next = [...blocks];
                  next[i] = { ...b, start: e.target.value };
                  setBlocks(next);
                }}
              />
              <span className="text-ink-muted">to</span>
              <Input
                type="time"
                value={b.end}
                onChange={(e) => {
                  const next = [...blocks];
                  next[i] = { ...b, end: e.target.value };
                  setBlocks(next);
                }}
              />
              <button
                type="button"
                onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}
                className="text-xs text-warn underline underline-offset-2"
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setBlocks([...blocks, { label: "", start: "", end: "" }])
            }
            className="self-start text-xs text-ink-muted underline underline-offset-2"
          >
            + add a protected block
          </button>
        </div>
      </div>

      {clientErrors.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 text-xs text-warn">
          {clientErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {state.errors.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 text-xs text-warn">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {state.ok && state !== INITIAL && clientErrors.length === 0 ? (
        <p className="text-xs text-primary">Saved.</p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending || clientErrors.length > 0}>
          {pending ? "Saving…" : "Save day profile"}
        </Button>
      </div>
    </form>
  );
}
