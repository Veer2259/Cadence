/**
 * lib/ai/modes/chat.ts — the assistant-rail loop (SPEC 6.6).
 *
 * Loads the last 30 messages for context, runs the model with the 7 tools,
 * executes task reads/writes inline, and stops with a pending action when the
 * model asks to compose or rebalance (the UI shows a confirmation card).
 * Persists the exchange and prunes chat_messages to the last 200.
 */

import "server-only";
import { desc, lt } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, type ChatMessage } from "@/db/schema";
import { runChatTurn } from "@/lib/ai/provider";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompts/chat";
import { CHAT_TOOLS, executeChatTool } from "@/lib/ai/chat-tools";
import type { ChatTurn } from "@/lib/ai/adapters/types";

const HISTORY_FOR_CONTEXT = 30;
const KEEP_MESSAGES = 200;
const MAX_STEPS = 5;

export type PendingAction = { kind: "compose" | "rebalance"; params: Record<string, unknown> };

export type ChatReply = {
  assistant: ChatMessage;
  pending: PendingAction | null;
};

/** Last N messages, oldest first — for rendering and for model context. */
export async function loadChatHistory(n = HISTORY_FOR_CONTEXT): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .orderBy(desc(chatMessages.createdAt))
    .limit(n);
  return rows.reverse();
}

function historyToTurns(history: ChatMessage[]): ChatTurn[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) =>
      m.role === "user"
        ? ({ role: "user", text: m.content } as const)
        : ({ role: "model", text: m.content } as const),
    );
}

export async function runChat(userText: string): Promise<ChatReply> {
  const text = userText.trim();
  const history = await loadChatHistory();

  const turns: ChatTurn[] = [...historyToTurns(history), { role: "user", text }];

  let replyText = "";
  let pending: PendingAction | null = null;
  const toolTrace: { name: string; args: unknown; result: unknown }[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await runChatTurn({
      role: "compose",
      system: CHAT_SYSTEM_PROMPT,
      turns,
      tools: CHAT_TOOLS,
    });

    if (out.kind === "text") {
      replyText = out.text.trim();
      break;
    }

    // tool calls
    turns.push({ role: "model", calls: out.calls, raw: out.raw });
    const responses: { name: string; response: Record<string, unknown> }[] = [];
    for (const call of out.calls) {
      const exec = await executeChatTool(call.name, call.args);
      if ("confirm" in exec) {
        pending = exec.confirm;
        toolTrace.push({ name: call.name, args: call.args, result: "pending confirmation" });
        responses.push({
          name: call.name,
          response: {
            status: "awaiting_user_confirmation",
            note: "A confirmation card is shown to the person. It has not run.",
          },
        });
      } else {
        toolTrace.push({ name: call.name, args: call.args, result: exec.result });
        responses.push({ name: call.name, response: exec.result });
      }
    }
    turns.push({ role: "tool", responses });
  }

  if (!replyText) {
    replyText = pending
      ? `Okay — a confirmation card for ${pending.kind} is waiting below.`
      : "Done.";
  }

  // --- persist ---
  const now = new Date();
  await db.insert(chatMessages).values([
    { role: "user", content: text, createdAt: now },
    {
      role: "assistant",
      content: replyText,
      toolCalls: { steps: toolTrace, pending: pending ?? undefined },
      createdAt: new Date(now.getTime() + 1),
    },
  ]);

  const [assistant] = await db
    .select()
    .from(chatMessages)
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  // prune to the last KEEP_MESSAGES
  const cutoffRow = await db
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .orderBy(desc(chatMessages.createdAt))
    .limit(1)
    .offset(KEEP_MESSAGES);
  if (cutoffRow[0]) {
    await db.delete(chatMessages).where(lt(chatMessages.createdAt, cutoffRow[0].createdAt));
  }

  return { assistant, pending };
}

/** Record an assistant line after a confirmation card was accepted / dismissed. */
export async function appendAssistantNote(content: string): Promise<ChatMessage> {
  await db.insert(chatMessages).values({ role: "assistant", content });
  const [row] = await db
    .select()
    .from(chatMessages)
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  return row;
}
