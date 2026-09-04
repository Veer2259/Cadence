/**
 * Anthropic adapter — forces a single tool whose input_schema is the Zod-derived
 * JSON Schema, then returns the tool input as JSON text (SPEC section 6).
 *
 * Notes that matter, and cost real debugging when forgotten:
 *
 *  - `tool_use` blocks carry a server-generated `id`, and every `tool_result`
 *    must reference the matching one via `tool_use_id`. Keying off the tool NAME
 *    works until the model calls one tool twice in a turn, at which point the
 *    ids collide and the results cannot be told apart. The real ids are carried
 *    through ToolCall.id / ToolResponse.id.
 *  - All results for one assistant turn go back in a SINGLE user message.
 *    Splitting them trains the model out of parallel calls.
 *  - The assistant turn is echoed back VERBATIM (`raw`), because on Opus/Sonnet
 *    5 thinking is on by default and thinking blocks must return unchanged on
 *    the same model. This is the Anthropic analogue of Gemini's thought
 *    signatures.
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

/**
 * Thinking is ON by default on the Claude 5 family, and thinking tokens count
 * against max_tokens. The old 2048 ceiling here left almost nothing for the
 * answer once the model had thought.
 */
const MAX_TOKENS_JSON = 16000;
const MAX_TOKENS_CHAT = 8000;

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
  const { model, system, messages, files, jsonSchema, schemaName } = args;

  const msgs: Anthropic.MessageParam[] = messages.map((m, i) => {
    const role = m.role === "model" ? ("assistant" as const) : ("user" as const);

    // Documents attach to the FIRST user message and must precede its text.
    if (i === 0 && role === "user" && files?.length) {
      return {
        role,
        content: [
          ...files.map(
            (f): Anthropic.DocumentBlockParam => ({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: f.data },
              ...(f.name ? { title: f.name } : {}),
            }),
          ),
          { type: "text" as const, text: m.content },
        ],
      };
    }
    return { role, content: m.content };
  });

  const res = await anthropic().messages.create({
    model,
    max_tokens: MAX_TOKENS_JSON,
    system,
    messages: msgs,
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
    // A refusal stops with no tool call; say which it was rather than "no tool call".
    if (res.stop_reason === "refusal") {
      throw new Error(
        `Anthropic declined this request (${res.stop_details?.category ?? "unspecified"}).`,
      );
    }
    if (res.stop_reason === "max_tokens") {
      throw new Error(`Anthropic hit max_tokens before finishing "${schemaName}".`);
    }
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
  const messages: Anthropic.MessageParam[] = [];

  for (const t of args.turns) {
    if (t.role === "user") {
      messages.push({ role: "user", content: t.text });
      continue;
    }
    if (t.role === "tool") {
      // Every result for the preceding assistant turn, in ONE user message.
      messages.push({
        role: "user",
        content: t.responses.map(
          (r): Anthropic.ToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: r.id ?? r.name,
            content: JSON.stringify(r.response),
          }),
        ),
      });
      continue;
    }
    if ("calls" in t) {
      // Prefer the verbatim turn: it carries thinking blocks, which must come
      // back unchanged on the same model.
      if (t.raw) {
        messages.push({
          role: "assistant",
          content: t.raw as Anthropic.ContentBlockParam[],
        });
      } else {
        messages.push({
          role: "assistant",
          content: t.calls.map(
            (c): Anthropic.ToolUseBlockParam => ({
              type: "tool_use",
              id: c.id ?? c.name,
              name: c.name,
              input: c.args,
            }),
          ),
        });
      }
      continue;
    }
    messages.push({ role: "assistant", content: t.text });
  }

  const res = await anthropic().messages.create({
    model: args.model,
    max_tokens: MAX_TOKENS_CHAT,
    system: args.system,
    tools: args.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    })),
    messages,
  });

  const toolUses = res.content.filter((b) => b.type === "tool_use");
  if (toolUses.length > 0) {
    return {
      kind: "calls",
      calls: toolUses.map((b) => ({
        name: b.name,
        args: b.input as Record<string, unknown>,
        id: b.id,
      })),
      // echoed back verbatim next turn, thinking blocks included
      raw: res.content,
    };
  }

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { kind: "text", text };
}

export const adapter: LlmAdapter = { name: "anthropic", generateJson, chatTurn };
