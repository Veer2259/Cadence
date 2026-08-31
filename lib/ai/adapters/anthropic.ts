/**
 * Anthropic adapter — forces a single tool whose input_schema is the Zod-derived
 * JSON Schema, then returns the tool input as JSON text (SPEC section 6).
 *
 * Not the active provider while LLM_PROVIDER=gemini, but kept working so the
 * switch is one env var.
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatArgs,
  ChatStep,
  GenerateJsonArgs,
  GenerateJsonResult,
  LlmAdapter,
} from "./types";

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    client = new Anthropic({ apiKey });
  }
  return client;
}

async function generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult> {
  const { model, system, messages, jsonSchema, schemaName } = args;

  const res = await anthropic().messages.create({
    model,
    max_tokens: 8192,
    system,
    messages: messages.map((m) => ({
      role: m.role === "model" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    tools: [
      {
        name: schemaName,
        description: "Return the result as the single argument to this tool.",
        input_schema: jsonSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: schemaName },
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic did not return a tool call.");
  }

  return {
    text: JSON.stringify(toolUse.input),
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  };
}

async function chatTurn(args: ChatArgs): Promise<ChatStep> {
  const res = await anthropic().messages.create({
    model: args.model,
    max_tokens: 2048,
    system: args.system,
    tools: args.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    })),
    messages: args.turns.map((t) => {
      if (t.role === "user") return { role: "user" as const, content: t.text };
      if (t.role === "tool") {
        return {
          role: "user" as const,
          content: t.responses.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.name,
            content: JSON.stringify(r.response),
          })),
        };
      }
      if ("calls" in t) {
        return {
          role: "assistant" as const,
          content: t.calls.map((c) => ({
            type: "tool_use" as const,
            id: c.name,
            name: c.name,
            input: c.args,
          })),
        };
      }
      return { role: "assistant" as const, content: t.text };
    }),
  });

  const toolUses = res.content.filter((b) => b.type === "tool_use");
  if (toolUses.length > 0) {
    return {
      kind: "calls",
      calls: toolUses.map((b) => ({
        name: b.type === "tool_use" ? b.name : "",
        args: (b.type === "tool_use" ? b.input : {}) as Record<string, unknown>,
      })),
    };
  }
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return { kind: "text", text };
}

export const adapter: LlmAdapter = { name: "anthropic", generateJson, chatTurn };
