/**
 * Anthropic adapter — forces a single tool whose input_schema is the Zod-derived
 * JSON Schema, then returns the tool input as JSON text (SPEC section 6).
 *
 * Not the active provider while LLM_PROVIDER=gemini, but kept working so the
 * switch is one env var.
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { GenerateJsonArgs, GenerateJsonResult, LlmAdapter } from "./types";

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

export const adapter: LlmAdapter = { name: "anthropic", generateJson };
