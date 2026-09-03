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

export function ChatPanel({ initial }: { initial: ChatMsg[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(
    initial.map((m, i) => ({ ...m, id: `init-${i}` })),
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
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
    start(async () => {
      let res;
      try {
        res = await sendChatMessage(text);
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
        res = accept
          ? await confirmChatAction({ kind: action.kind, params: action.params })
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
            Ask for anything you could tap — &ldquo;add a task to call the mill
            tomorrow&rdquo;, &ldquo;what did I log this week&rdquo;, &ldquo;plan my
            day&rdquo;.
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
                  <p className="text-[13px] font-semibold text-ink">
                    {m.pending.kind === "drop_block" ? (
                      <>
                        Drop &ldquo;{String(m.pending.params.title ?? "this block")}&rdquo; from
                        the plan?
                      </>
                    ) : (
                      <>
                        Run {m.pending.kind}?
                        {m.pending.kind === "rebalance" && m.pending.params.energy
                          ? ` (energy: ${String(m.pending.params.energy)})`
                          : ""}
                      </>
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
          placeholder="Type a request…"
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
