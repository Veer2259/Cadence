"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea } from "@/components/ui/controls";
import {
  sendBreakdown,
  acceptBreakdown,
  clearBreakdown,
} from "@/app/(app)/goals/actions";
import type { BreakdownTurn } from "@/lib/ai/schemas";
import { describeThrown } from "@/lib/thrown";

type Msg = { role: "user" | "assistant"; content: string };

type FollowOn = {
  mode: "targets" | "direct";
  note: string | null;
  candidates: {
    title: string;
    weeklyTargetId: string | null;
    category: "deep" | "shallow" | "calls" | "admin" | "errand" | "personal";
    estimateMin: number;
    reason: string;
  }[];
};
type Proposal = NonNullable<BreakdownTurn["proposal"]>;
type EditableTarget = { weekStart: string; description: string; targetHours: string };

/**
 * The breakdown dialogue plus its review list.
 *
 * The model never writes. Its proposal lands in editable fields; only what the
 * person confirms — as edited — is saved.
 */
export function BreakdownPanel({
  buckets,
  initialBucketId,
  initialMessages,
  initialProposal,
}: {
  buckets: { id: string; name: string }[];
  initialBucketId: string | null;
  initialMessages: Msg[];
  initialProposal: Proposal | null;
}) {
  const router = useRouter();
  const [bucketId, setBucketId] = useState(initialBucketId ?? buckets[0]?.id ?? "");
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [outcome, setOutcome] = useState(initialProposal?.outcome ?? "");
  const [targetDate, setTargetDate] = useState(initialProposal?.outcomeTargetDate ?? "");
  const [rows, setRows] = useState<EditableTarget[]>(
    (initialProposal?.weeklyTargets ?? []).map((t) => ({
      weekStart: t.weekStart,
      description: t.description,
      targetHours: t.targetHours == null ? "" : String(t.targetHours),
    })),
  );
  const [reasoning, setReasoning] = useState(initialProposal?.reasoning ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  /**
   * Task candidates the accept produced in the same round trip.
   *
   * The bug being fixed is that setting a goal and getting tasks out of it
   * looked like one step and were two, so this is deliberately rendered right
   * here rather than sending the person to another screen.
   */
  const [followOn, setFollowOn] = useState<FollowOn | null>(null);

  function send() {
    const text = input.trim();
    if (!text || !bucketId || pending) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    start(async () => {
      let res;
      try {
        res = await sendBreakdown(bucketId, text);
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: res.turn.reply }]);
      if (res.turn.proposal) {
        setOutcome(res.turn.proposal.outcome);
        setTargetDate(res.turn.proposal.outcomeTargetDate ?? "");
        setReasoning(res.turn.proposal.reasoning);
        setRows(
          res.turn.proposal.weeklyTargets.map((t) => ({
            weekStart: t.weekStart,
            description: t.description,
            targetHours: t.targetHours == null ? "" : String(t.targetHours),
          })),
        );
      }
    });
  }

  function accept() {
    start(async () => {
      let res;
      try {
        res = await acceptBreakdown({
        bucketId,
        outcome: outcome.trim(),
        outcomeTargetDate: targetDate || null,
        weeklyTargets: rows
          .filter((r) => r.description.trim())
          .map((r) => ({
            weekStart: r.weekStart,
            description: r.description.trim(),
            targetHours: r.targetHours === "" ? null : Number(r.targetHours),
          })),
        });
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      const targetsPart =
        res.created && res.created > 0
          ? ` and ${res.created} weekly target${res.created === 1 ? "" : "s"}`
          : "";
      setSaved(`Saved the outcome${targetsPart}.`);
      setFollowOn(res.followOn ?? null);
      if (res.followOnError) {
        setError(`Saved, but proposing tasks failed: ${res.followOnError}`);
      }
      router.refresh();
    });
  }

  const hasProposal = outcome.trim().length > 0 || rows.length > 0;

  const followOnPanel = followOn ? (
    <div className="rounded-[18px] bg-surface p-4 shadow-card">
      <p className="text-[11px] font-extrabold tracking-[0.12em] text-primary uppercase">
        {followOn.mode === "direct"
          ? "Tasks for this goal"
          : "Tasks for this week"}
      </p>
      <p className="mt-1 text-[12.5px] font-semibold text-ink-faint">
        {followOn.mode === "direct"
          ? "The deadline is close enough that weekly targets would not add anything, so these are proposed straight against the goal."
          : "Proposed against the targets you just saved."}
      </p>

      {followOn.note ? (
        <p className="mt-2 text-[13px] leading-[1.5] font-medium text-ink-muted">
          {followOn.note}
        </p>
      ) : null}

      {followOn.candidates.length === 0 ? (
        <p className="mt-2 text-[13px] font-medium text-ink-muted">
          Nothing proposed.
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {followOn.candidates.map((c, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-ink">{c.title}</span>
                  <span className="block text-[11.5px] font-semibold text-ink-faint">
                    {c.category} · {c.reason}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[12px] font-extrabold text-ink-muted">
                  {c.estimateMin}m
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] font-semibold text-ink-faint">
            Nothing here is saved yet — keep or discard each one in the review
            list below, then add them.
          </p>
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">Bucket</span>
          <Select
            value={bucketId}
            onChange={(e) => {
              setBucketId(e.target.value);
              setMessages([]);
              setError(null);
            }}
          >
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        {messages.length > 0 ? (
          <Button
            type="button"
            variant="quiet"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await clearBreakdown(bucketId);
                setMessages([]);
                setRows([]);
                setOutcome("");
                setSaved(null);
                router.refresh();
              })
            }
          >
            Start over
          </Button>
        ) : null}
      </div>

      {/* the dialogue */}
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Say what you are trying to achieve in this bucket. It will ask about
            scope, what is already done, dependencies and who else is involved
            before proposing anything — and it will argue with you if the plan
            does not match the hours you actually log.
          </p>
        ) : (
          messages.map((m, i) => {
            const mine = m.role === "user";
            return (
              <div key={i} className={mine ? "ml-10" : "mr-10"}>
                <p
                  className={
                    "mb-1 text-[10px] font-extrabold tracking-[0.1em] uppercase " +
                    (mine ? "text-right text-ink-faint" : "text-primary")
                  }
                >
                  {mine ? "You" : "Cadence"}
                </p>
                <div
                  className={
                    "px-3.5 py-2.5 text-[13.5px] leading-relaxed font-medium whitespace-pre-wrap " +
                    (mine ? "bg-tint text-ink" : "bg-surface text-ink-muted shadow-card")
                  }
                  style={{
                    borderRadius: "16px",
                    [mine ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: "6px",
                  }}
                >
                  {m.content}
                </div>
              </div>
            );
          })
        )}
        {pending ? <p className="text-xs text-ink-muted">Thinking…</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your answer…"
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={pending || !input.trim()}>
          Send
        </Button>
      </form>

      {/* the review list — nothing above this has written anything */}
      {hasProposal ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-ink uppercase">
              Proposal — review and edit before saving
            </h3>
            {reasoning ? (
              <p className="mt-1 border-l-2 border-line pl-3 text-sm text-ink-muted">
                {reasoning}
              </p>
            ) : null}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Outcome</span>
            <Textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="min-h-[3rem]"
            />
          </label>

          <label className="flex w-44 flex-col gap-1">
            <span className="text-xs text-ink-muted">Target date</span>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>

          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Week</span>
                  <Input
                    type="date"
                    value={r.weekStart}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x, j) => (j === i ? { ...x, weekStart: e.target.value } : x)),
                      )
                    }
                    className="w-40"
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-ink-muted">Target</span>
                  <Input
                    value={r.description}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Hours</span>
                  <Input
                    type="number"
                    min={0}
                    max={168}
                    step={0.5}
                    value={r.targetHours}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x, j) => (j === i ? { ...x, targetHours: e.target.value } : x)),
                      )
                    }
                    className="w-24"
                  />
                </label>
                <Button
                  type="button"
                  variant="danger"
                  className="px-2 py-1 text-xs"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={accept} disabled={pending || !outcome.trim()}>
              {pending ? "Saving…" : "Save outcome + targets"}
            </Button>
            {saved ? <span className="text-xs text-primary">{saved}</span> : null}
          </div>

          {/* The handoff, in the same place the person just pressed Save. */}
          {followOnPanel}
        </div>
      ) : null}
    </div>
  );
}
