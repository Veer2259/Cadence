"use client";

/**
 * Timetable import: upload, review, confirm.
 *
 * The review step is the point of the whole thing. It shows sessions grouped by
 * day, EXCLUDED sessions struck through with their reason, undated rows as
 * blocking failures, and — before anything is written — exactly what a confirm
 * would replace.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { describeThrown } from "@/lib/thrown";
import { Button, Textarea } from "@/components/ui/controls";
import {
  parseTimetableFile,
  confirmTimetable,
  type ParseReply,
} from "@/app/(app)/settings/timetable-actions";
import { groupByDay } from "@/lib/timetable";
import type { TimetableParse } from "@/lib/schemas";

type Loaded = Extract<ParseReply, { ok: true }>;

const KIND_LABEL: Record<string, string> = {
  mid_block: "Mid block",
  end_block: "End block",
  other: "Exam",
};

export function TimetableImport() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [instruction, setInstruction] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [parse, setParse] = useState<TimetableParse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function upload(form: FormData) {
    setError(null);
    setDone(null);
    form.set("instruction", instruction);
    start(async () => {
      let res;
      try {
        res = await parseTimetableFile(form);
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLoaded(res);
      setParse(res.parse);
    });
  }

  function toggleExcluded(i: number) {
    setParse((p) =>
      p
        ? {
            ...p,
            sessions: p.sessions.map((s, j) =>
              j === i
                ? {
                    ...s,
                    excluded: !s.excluded,
                    reason: !s.excluded ? (s.reason ?? "Excluded by hand") : s.reason,
                  }
                : s,
            ),
          }
        : p,
    );
  }

  function confirm() {
    if (!parse) return;
    setError(null);
    start(async () => {
      let res;
      try {
        res = await confirmTimetable({
          parse,
          instruction,
          fileName: fileName ?? undefined,
        });
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const goalLine = res.goals.length
        ? ` ${res.goals.length} exam goal${res.goals.length === 1 ? "" : "s"} set.`
        : "";
      setDone(
        `Saved ${res.written} class${res.written === 1 ? "" : "es"}` +
          (res.replaced ? `, replacing ${res.replaced}` : "") +
          `. ${res.examsWritten} exam${res.examsWritten === 1 ? "" : "s"} recorded.${goalLine}`,
      );
      setLoaded(null);
      setParse(null);
      router.refresh();
    });
  }

  // --- upload form ---
  if (!parse || !loaded) {
    return (
      <form action={upload} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-ink-soft">Timetable PDF</span>
          <input
            type="file"
            name="pdf"
            accept="application/pdf"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="rounded-[14px] bg-tint px-3.5 py-2.5 text-sm font-medium text-ink file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-extrabold file:text-paper"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-ink-soft">
            How should it be read?
          </span>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. I'm in section B for both subjects — exclude everything marked _A."
            className="min-h-[5rem] w-full"
          />
          <span className="text-[11.5px] font-medium text-ink-faint">
            The PDF and this note go to the model together. Name the classes you
            have NOT opted for and they will be shown struck through, never
            silently dropped.
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-[13px] font-semibold text-warn">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="text-[13px] font-semibold text-primary">{done}</p>
        ) : null}

        <Button type="submit" disabled={pending} size="lg" className="w-full">
          {pending ? "Reading the timetable…" : "Read the timetable"}
        </Button>
      </form>
    );
  }

  // --- review ---
  const { days, undated } = groupByDay(parse.sessions);
  const indexOf = (s: (typeof parse.sessions)[number]) => parse.sessions.indexOf(s);
  const blocking = loaded.problems.length > 0 || undated.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">
          {parse.termLabel ?? "Review"}
        </p>
        <button
          type="button"
          onClick={() => {
            setParse(null);
            setLoaded(null);
          }}
          className="text-[12px] font-bold text-ink-soft underline underline-offset-2"
        >
          Start over
        </button>
      </div>

      {parse.warnings.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">Check these</p>
          <ul className="list-disc pl-4 text-[12.5px] font-medium text-ink-muted">
            {parse.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {undated.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">
            {undated.length} session{undated.length === 1 ? "" : "s"} could not be dated
          </p>
          <p className="mb-2 text-[12.5px] font-medium text-ink-muted">
            No date was read from the PDF, and none will be guessed. Exclude
            these or fix the timetable — a class on the wrong date is worse than
            a missing one.
          </p>
          <ul className="flex flex-col gap-1.5">
            {undated.map((s) => (
              <li key={indexOf(s)} className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-ink">{s.title}</span>
                <button
                  type="button"
                  onClick={() => toggleExcluded(indexOf(s))}
                  className="rounded-full bg-surface px-3 py-1 text-[11px] font-extrabold text-warn"
                >
                  {s.excluded ? "Excluded" : "Exclude"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {days.map((d) => (
        <div key={d.date} className="rounded-[18px] bg-surface p-3.5 shadow-card">
          <p className="text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
            {d.date}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {d.sessions.map((s) => {
              const i = indexOf(s);
              return (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13.5px] font-bold",
                        s.excluded ? "text-ink-ghost line-through" : "text-ink",
                      )}
                    >
                      {s.title}
                      {s.uncertain ? (
                        <span className="ml-1.5 rounded-full bg-warn-tint px-2 py-0.5 text-[10px] font-extrabold text-warn">
                          unsure
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular block text-[11.5px] font-semibold text-ink-faint">
                      {s.start ?? "??"}–{s.end ?? "??"}
                      {s.location ? ` · ${s.location}` : ""}
                    </span>
                    {s.excluded && s.reason ? (
                      <span className="block text-[11.5px] font-medium text-warn">
                        {s.reason}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExcluded(i)}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold",
                      s.excluded ? "bg-tint text-ink-soft" : "bg-warn-tint text-warn",
                    )}
                  >
                    {s.excluded ? "Include" : "Exclude"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {parse.exams.length ? (
        <div className="rounded-[18px] bg-primary-tint p-3.5">
          <p className="text-[11px] font-extrabold tracking-[0.12em] text-primary-deep uppercase">
            Exams — each becomes a goal
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {parse.exams.map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-bold text-ink">
                  {e.subjectCode} · {KIND_LABEL[e.kind] ?? "Exam"}
                </span>
                <span className="tabular text-[12px] font-semibold text-primary-deep">
                  {e.date ?? "no date"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] font-medium text-ink-muted">
            Each subject&rsquo;s bucket gets its next exam as an outcome, so the
            planner can propose the work that leads up to it.
          </p>
        </div>
      ) : null}

      {loaded.willReplace.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">
            This replaces {loaded.willReplace.length} previously imported class
            {loaded.willReplace.length === 1 ? "" : "es"}
          </p>
          <ul className="text-[12px] font-medium text-ink-muted">
            {loaded.willReplace.slice(0, 8).map((c) => (
              <li key={c.id}>
                {c.date} · {c.title}
              </li>
            ))}
            {loaded.willReplace.length > 8 ? (
              <li>…and {loaded.willReplace.length - 8} more</li>
            ) : null}
          </ul>
          <p className="mt-1.5 text-[11.5px] font-semibold text-ink-faint">
            Commitments you added by hand are never touched.
          </p>
        </div>
      ) : null}

      {loaded.planConflicts.length ? (
        <div className="rounded-2xl border border-warn-line bg-warn-tint p-3.5">
          <p className="mb-1 text-[13px] font-extrabold text-warn">
            Plans already exist for {loaded.planConflicts.length} of these days
          </p>
          <p className="text-[12.5px] font-medium text-ink-muted">
            {loaded.planConflicts.join(", ")}. Those plans are left exactly as
            they are — nothing is recomposed. Re-plan a day yourself if its
            classes changed.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-warn">
          {error}
        </p>
      ) : null}

      <Button
        onClick={confirm}
        disabled={pending || blocking}
        size="lg"
        className="w-full"
      >
        {pending
          ? "Saving…"
          : blocking
            ? "Fix the undated sessions first"
            : "Save these classes"}
      </Button>
    </div>
  );
}
