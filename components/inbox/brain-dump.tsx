"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { CATEGORIES } from "@/lib/schemas";
import { Button, Input, Select, Textarea } from "@/components/ui/controls";
import {
  captureBrainDump,
  confirmCapturedTasks,
} from "@/app/(app)/inbox/actions";
import type { CapturedTask } from "@/lib/ai/schemas";
import { describeThrown } from "@/lib/thrown";

type Draft = {
  include: boolean;
  title: string;
  category: string;
  bucketName: string;
  estimateMin: string;
  dueDate: string;
  possibleDuplicateOf: string | null;
};

function toDraft(t: CapturedTask): Draft {
  return {
    include: !t.possibleDuplicateOf,
    title: t.title,
    category: t.category,
    bucketName: t.bucketName ?? "",
    estimateMin: t.estimateMin != null ? String(t.estimateMin) : "",
    dueDate: t.dueAt ? t.dueAt.slice(0, 10) : "",
    possibleDuplicateOf: t.possibleDuplicateOf,
  };
}

export function BrainDump({ buckets }: { buckets: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState("");
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function parse(withAnswers?: string) {
    setError(null);
    setNote(null);
    start(async () => {
      let res;
      try {
        res = await captureBrainDump(text, withAnswers);
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setClarifications(res.clarifications);
      setDrafts(res.tasks.map(toDraft));
      if (res.tasks.length === 0 && res.clarifications.length === 0) {
        setNote("Nothing actionable found in that.");
      }
    });
  }

  function reset() {
    setText("");
    setAnswers("");
    setClarifications([]);
    setDrafts(null);
    setError(null);
    setNote(null);
  }

  function confirm() {
    if (!drafts) return;
    const chosen = drafts.filter((d) => d.include && d.title.trim());
    if (chosen.length === 0) {
      setError("Nothing selected to add.");
      return;
    }
    start(async () => {
      let res;
      try {
        res = await confirmCapturedTasks({
        tasks: chosen.map((d) => ({
          title: d.title,
          bucketName: d.bucketName || null,
          category: d.category,
          estimateMin: d.estimateMin ? Number(d.estimateMin) : null,
          dueDate: d.dueDate || null,
        })),
        });
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.errors.join("; "));
        return;
      }
      reset();
      setNote(`Added ${chosen.length} to the inbox below.`);
      router.refresh();
    });
  }

  function setDraft(i: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev && prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  return (
    <div
      className="rounded-[18px] bg-surface p-3.5 shadow-card"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Brain dump</span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type everything on your mind. One line or ten — the parser splits it into tasks."
          className="min-h-[3.5rem]"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => parse()} disabled={pending || text.trim().length < 3}>
          {pending && !drafts ? "Reading…" : "Capture"}
        </Button>
        {drafts !== null ? (
          <Button variant="quiet" onClick={reset} disabled={pending}>
            Clear
          </Button>
        ) : null}
        {note ? <span className="text-xs font-semibold text-primary">{note}</span> : null}
        {error ? (
          <span role="alert" className="text-xs text-warn">
            {error}
          </span>
        ) : null}
      </div>

      {clarifications.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[14px] font-bold text-ink">Before I can capture that, a few things:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
            {clarifications.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <Textarea
            value={answers}
            onChange={(e) => setAnswers(e.target.value)}
            placeholder="Answer here…"
            className="mt-2 w-full"
          />
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => parse(answers)}
              disabled={pending || answers.trim().length < 2}
            >
              {pending ? "Refining…" : "Refine with answers"}
            </Button>
          </div>
        </div>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
            {drafts.length} parsed — edit, then add
          </p>
          <ul className="flex flex-col gap-2">
            {drafts.map((d, i) => (
              <li
                key={i}
                className={cn(
                  "flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-b-0",
                  !d.include && "opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  checked={d.include}
                  onChange={(e) => setDraft(i, { include: e.target.checked })}
                  aria-label={`Include ${d.title}`}
                />
                <Input
                  value={d.title}
                  onChange={(e) => setDraft(i, { title: e.target.value })}
                  className="min-w-[12rem] flex-1"
                />
                <Select
                  value={d.category}
                  onChange={(e) => setDraft(i, { category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select
                  value={d.bucketName}
                  onChange={(e) => setDraft(i, { bucketName: e.target.value })}
                >
                  <option value="">— bucket —</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  value={d.estimateMin}
                  onChange={(e) => setDraft(i, { estimateMin: e.target.value })}
                  placeholder="min"
                  className="w-20"
                />
                <Input
                  type="date"
                  value={d.dueDate}
                  onChange={(e) => setDraft(i, { dueDate: e.target.value })}
                  className="w-36"
                />
                {d.possibleDuplicateOf ? (
                  <span className="text-xs text-caution">
                    looks like “{d.possibleDuplicateOf}”
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <Button onClick={confirm} disabled={pending}>
              {pending ? "Adding…" : `Add ${drafts.filter((d) => d.include).length} to inbox`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
