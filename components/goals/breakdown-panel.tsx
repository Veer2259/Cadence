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

type Msg = { role: "user" | "assistant"; content: string };
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

  function send() {
    const text = input.trim();
    if (!text || !bucketId || pending) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    start(async () => {
      const res = await sendBreakdown(bucketId, text);
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
      const res = await acceptBreakdown({
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
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setSaved(`Saved the outcome and ${res.created ?? 0} weekly target(s).`);
      router.refresh();
    });
  }

  const hasProposal = outcome.trim().length > 0 || rows.length > 0;

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
      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Say what you are trying to achieve in this bucket. It will ask about
            scope, what is already done, dependencies and who else is involved
            before proposing anything — and it will argue with you if the plan
            does not match the hours you actually log.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="text-sm">
              <span className="mr-1 font-mono text-[10px] tracking-wide text-ink-muted uppercase">
                {m.role === "user" ? "you" : "cadence"}
              </span>
              <span
                className={
                  m.role === "user" ? "whitespace-pre-wrap text-ink" : "judgment whitespace-pre-wrap text-ink-muted"
                }
              >
                {m.content}
              </span>
            </div>
          ))
        )}
        {pending ? <p className="text-xs text-ink-muted">Thinking…</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-signal">
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
        <div className="flex flex-col gap-3 border-t border-rule pt-3">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-ink uppercase">
              Proposal — review and edit before saving
            </h3>
            {reasoning ? (
              <p className="judgment mt-1 border-l-2 border-rule pl-3 text-sm text-ink-muted">
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
            {saved ? <span className="text-xs text-settled">{saved}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
