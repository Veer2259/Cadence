"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  sendChatMessage,
  confirmChatAction,
  dismissChatAction,
  type ChatMsg,
} from "@/app/(app)/chat/actions";

type Msg = ChatMsg & { id: string };

const OPEN_KEY = "cadence.chat.open";

export function ChatRail({ initial }: { initial: ChatMsg[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(
    initial.map((m, i) => ({ ...m, id: `init-${i}` })),
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // client-only: restore the last open/closed state after mount
    const restore = () => {
      try {
        setOpen(localStorage.getItem(OPEN_KEY) === "1");
      } catch {
        /* ignore */
      }
    };
    restore();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

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
      const res = await sendChatMessage(text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      push(res.assistant);
    });
  }

  function resolve(accept: boolean, action: NonNullable<ChatMsg["pending"]>, msgId: string) {
    start(async () => {
      const res = accept
        ? await confirmChatAction({ kind: action.kind, params: action.params })
        : { ok: true as const, note: (await dismissChatAction()).note, changed: false };
      // clear the pending card on that message
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, pending: null } : m)),
      );
      const note = "note" in res ? res.note : "error" in res ? res.error : "Done.";
      push({ role: "assistant", content: note, createdAt: new Date().toISOString(), pending: null });
      if (accept && "changed" in res && res.changed) router.refresh();
    });
  }

  return (
    <div className="fixed right-3 bottom-3 z-50 flex flex-col items-end sm:right-4 sm:bottom-4">
      {open ? (
        <div
          className="flex h-[70vh] max-h-[560px] w-[min(92vw,380px)] flex-col border border-rule bg-surface"
          style={{ borderRadius: "var(--radius)" }}
        >
          <div className="flex items-center justify-between border-b border-rule px-3 py-2">
            <span className="font-mono text-xs tracking-tight text-ink">Assistant</span>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-ink-muted hover:text-ink"
              aria-label="Close assistant"
            >
              Close
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Ask for anything you could click — “add a task to call the mill
                tomorrow”, “what did I log this week”, “plan my day”.
              </p>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={cn("text-sm", m.role === "user" ? "text-ink" : "text-ink-muted")}>
                <span className="mr-1 font-mono text-[10px] tracking-wide text-ink-muted uppercase">
                  {m.role === "user" ? "you" : "cadence"}
                </span>
                <span className="whitespace-pre-wrap">{m.content}</span>

                {m.pending ? (
                  <div
                    className="mt-2 border border-caution/60 bg-paper p-2"
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    <p className="text-xs text-ink">
                      Run <span className="font-medium">{m.pending.kind}</span>?
                      {m.pending.kind === "rebalance" && m.pending.params.energy
                        ? ` (energy: ${String(m.pending.params.energy)})`
                        : ""}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={pending}
                        onClick={() => resolve(true, m.pending!, m.id)}
                        className="bg-ink px-2.5 py-1 text-xs font-medium text-paper disabled:opacity-60"
                        style={{ borderRadius: "var(--radius)" }}
                      >
                        Confirm
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => resolve(false, m.pending!, m.id)}
                        className="border border-rule px-2.5 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-60"
                        style={{ borderRadius: "var(--radius)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {pending ? <p className="text-xs text-ink-muted">…</p> : null}
            {error ? (
              <p role="alert" className="text-xs text-signal">
                {error}
              </p>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex gap-2 border-t border-rule p-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a request…"
              className="min-w-0 flex-1 border border-rule bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink"
              style={{ borderRadius: "var(--radius)" }}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-60"
              style={{ borderRadius: "var(--radius)" }}
            >
              Send
            </button>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="border border-rule bg-surface px-3 py-2 font-mono text-xs tracking-tight text-ink shadow-none hover:border-ink"
          style={{ borderRadius: "var(--radius)" }}
        >
          Assistant
        </button>
      )}
    </div>
  );
}
