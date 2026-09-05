"use client";

/**
 * The assistant transcript.
 *
 * Was a floating panel that opened itself from a corner button and remembered
 * its own open/closed state in localStorage. It is now the body of a sheet, so
 * open/closed belongs to whatever mounted the sheet — this component only
 * renders the conversation and the composer.
 *
 * Message bubbles follow the Goals treatment: Cadence in white with a square
 * bottom-left corner, you in tint with a square bottom-right corner.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { describeThrown } from "@/lib/thrown";
import { Button } from "@/components/ui/controls";
import {
  sendChatMessage,
  confirmChatAction,
  dismissChatAction,
  type ChatMsg,
} from "@/app/(app)/chat/actions";

type Msg = ChatMsg & { id: string };

type CapturedTask = {
  title: string;
  category: string;
  estimateMin: number | null;
  bucketName: string | null;
  dueDate: string | null;
  possibleDuplicateOf?: string | null;
};

/**
 * The capture review list, inside the conversation.
 *
 * Capture proposes and never writes (SPEC 6.2), so this is where the person
 * says which of the parsed tasks are real. Everything is kept by default —
 * unticking is the deliberate act, because the common case after a dump is
 * "yes, all of that".
 */
function CaptureCard({
  msgId,
  tasks,
  keep,
  onToggle,
}: {
  msgId: string;
  tasks: CapturedTask[];
  keep: boolean[] | undefined;
  onToggle: (i: number) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <ul className="mb-2.5 flex flex-col gap-1.5">
      {tasks.map((t, i) => {
        const on = keep?.[i] !== false;
        return (
          <li key={`${msgId}-${i}`}>
            <button
              type="button"
              onClick={() => onToggle(i)}
              aria-pressed={on}
              className="flex w-full items-start gap-2 text-left"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-extrabold",
                  on ? "bg-ink text-paper" : "bg-surface text-transparent",
                )}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[13px] font-bold",
                    on ? "text-ink" : "text-ink-ghost line-through",
                  )}
                >
                  {t.title}
                </span>
                <span className="block text-[11px] font-semibold text-ink-faint">
                  {[t.category, t.bucketName, t.estimateMin ? `${t.estimateMin}m` : null,
                    t.dueDate ? `due ${t.dueDate}` : null,
                    t.possibleDuplicateOf ? `maybe a duplicate of "${t.possibleDuplicateOf}"` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ChatPanel({
  initial,
  startInDumpMode = false,
  bucketNames = [],
}: {
  initial: ChatMsg[];
  /** the tab bar's + opens straight into brain-dump mode */
  startInDumpMode?: boolean;
  bucketNames?: string[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(
    initial.map((m, i) => ({ ...m, id: `init-${i}` })),
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  /**
   * Brain-dump mode. The assistant can usually tell a dump from an instruction
   * on its own, but saying so removes the guess entirely — and the guess is the
   * one it would be most expensive to get wrong, because a dump misread as an
   * instruction would start editing the day.
   */
  const [dumpMode, setDumpMode] = useState(startInDumpMode);
  /** per-card keep/discard state, keyed by message id */
  const [keeps, setKeeps] = useState<Record<string, boolean[]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function push(m: Omit<Msg, "id">) {
    setMessages((prev) => [...prev, { ...m, id: crypto.randomUUID() }]);
  }

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setError(null);
    setInput("");
    push({ role: "user", content: text, createdAt: new Date().toISOString(), pending: null });
    // The marker is prepended to what the model sees, not to what is shown —
    // the transcript should read as the person's own words.
    const outgoing = dumpMode
      ? `[BRAIN DUMP — capture this, do not act on it as an instruction]\n${text}`
      : text;
    setDumpMode(false);
    start(async () => {
      let res;
      try {
        res = await sendChatMessage(outgoing);
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      push(res.assistant);
    });
  }

  function resolve(accept: boolean, action: NonNullable<ChatMsg["pending"]>, msgId: string) {
    start(async () => {
      let res;
      try {
        // For a capture card the params are whatever survived keep/discard —
        // the person's edit, not the model's proposal.
        const params =
          action.kind === "capture_tasks"
            ? {
                ...action.params,
                tasks: ((action.params.tasks ?? []) as CapturedTask[]).filter(
                  (_, i) => keeps[msgId]?.[i] !== false,
                ),
              }
            : action.params;
        res = accept
          ? await confirmChatAction({ kind: action.kind, params })
          : { ok: true as const, note: (await dismissChatAction()).note, changed: false };
      } catch (e) {
        setError(describeThrown(e));
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, pending: null } : m)));
      const note = "note" in res ? res.note : "error" in res ? res.error : "Done.";
      push({ role: "assistant", content: note, createdAt: new Date().toISOString(), pending: null });
      if (accept && "changed" in res && res.changed) router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        {messages.length === 0 ? (
          <p className="text-[13.5px] leading-relaxed font-medium text-ink-faint">
            Everything the app does is here. &ldquo;Plan my day&rdquo;, &ldquo;push
            the CV work an hour&rdquo;, &ldquo;mark the deck done&rdquo;,
            &ldquo;what did I log this week&rdquo;, &ldquo;close the day&rdquo;.
            <br />
            <br />
            To empty your head, press <span className="font-bold">Brain dump</span>{" "}
            and type everything at once — it will be captured as tasks for you to
            confirm, not acted on.
          </p>
        ) : null}

        {messages.map((m) => {
          const mine = m.role === "user";
          return (
            <div key={m.id} className={cn(mine ? "ml-10" : "mr-10")}>
              <p
                className={cn(
                  "mb-1 text-[10px] font-extrabold tracking-[0.1em] uppercase",
                  mine ? "text-right text-ink-faint" : "text-primary",
                )}
              >
                {mine ? "You" : "Cadence"}
              </p>
              <div
                className={cn(
                  "px-3.5 py-2.5 text-[13.5px] leading-relaxed font-medium whitespace-pre-wrap",
                  mine ? "bg-tint text-ink" : "bg-surface text-ink-muted shadow-card",
                )}
                style={{
                  borderRadius: "16px",
                  [mine ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: "6px",
                }}
              >
                {m.content}
              </div>

              {m.pending ? (
                <div className="mt-2 rounded-2xl border border-warn-line bg-warn-tint p-3">
                  {m.pending.kind === "capture_tasks" ? (
                    <CaptureCard
                      msgId={m.id}
                      tasks={(m.pending.params.tasks ?? []) as CapturedTask[]}
                      keep={keeps[m.id]}
                      onToggle={(i) =>
                        setKeeps((k) => {
                          const list =
                            k[m.id] ??
                            ((m.pending!.params.tasks ?? []) as CapturedTask[]).map(() => true);
                          const next = [...list];
                          next[i] = !next[i];
                          return { ...k, [m.id]: next };
                        })
                      }
                    />
                  ) : null}
                  <p className="text-[13px] font-semibold text-ink">
                    {m.pending.kind === "drop_block" ? (
                      <>
                        Drop &ldquo;{String(m.pending.params.title ?? "this block")}&rdquo; from
                        the plan?
                      </>
                    ) : m.pending.kind === "capture_tasks" ? (
                      <>Add the ones you kept?</>
                    ) : m.pending.kind === "commit_plan" ? (
                      <>Commit this plan?</>
                    ) : m.pending.kind === "discard_plan" ? (
                      <>Discard the draft?</>
                    ) : m.pending.kind === "close_day" ? (
                      <>
                        Close the day? This updates calibration and cannot be
                        undone.
                      </>
                    ) : (
                      <>Build today&rsquo;s plan?</>
                    )}
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <Button
                      variant="dark"
                      disabled={pending}
                      onClick={() => resolve(true, m.pending!, m.id)}
                      className="px-4 text-[13px]"
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={pending}
                      onClick={() => resolve(false, m.pending!, m.id)}
                      className="px-4 text-[13px]"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {pending ? (
          <p className="text-[12px] font-semibold text-ink-faint">Thinking…</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[13px] font-semibold text-warn">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-5 pt-2">
        <button
          type="button"
          aria-pressed={dumpMode}
          onClick={() => setDumpMode((v) => !v)}
          className={cn(
            "min-h-[32px] rounded-full px-3.5 text-[12px] font-extrabold",
            dumpMode ? "bg-ink text-paper" : "bg-tint text-ink-soft",
          )}
        >
          Brain dump
        </button>
        <span className="text-[11.5px] font-medium text-ink-faint">
          {dumpMode
            ? "Next message is captured as tasks, not acted on."
            : bucketNames.length > 0
              ? `Ask for anything — ${bucketNames.slice(0, 3).join(", ")}…`
              : "Ask for anything you could tap."}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 gap-2 px-5 pt-2"
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dumpMode ? "Everything on your mind…" : "Type a request…"}
          aria-label="Message Cadence"
          className="min-w-0 flex-1 rounded-full bg-tint px-4 py-3 text-[14px] font-medium text-ink placeholder:text-ink-faint outline-none focus:bg-surface focus:ring-2 focus:ring-primary/40"
        />
        <Button type="submit" disabled={pending || !input.trim()} className="px-5">
          Send
        </Button>
      </form>
    </div>
  );
}
