import type { ChatMessage } from "../provider";
import type { ProviderName } from "../models";

/**
 * A file sent alongside the prompt in the SAME call — a PDF timetable and the
 * instruction describing how to read it are one input, not two.
 *
 * Gemini takes this as an inlineData part; Anthropic as a document block placed
 * BEFORE the text. Both are base64, no beta header on either.
 */
export type InputFile = {
  /** base64, no newlines */
  data: string;
  mediaType: "application/pdf";
  /** shown to the model so it can refer to the file by name */
  name?: string;
};

export type GenerateJsonArgs = {
  model: string;
  system: string;
  messages: ChatMessage[];
  /** attached to the FIRST user message, before its text */
  files?: InputFile[];
  /** JSON Schema (draft 2020-12) describing the required output shape. */
  jsonSchema: Record<string, unknown>;
  /** Name for the schema / forced tool. */
  schemaName: string;
};

export type GenerateJsonResult = {
  /** Raw JSON text from the model. */
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
};

/* -------------------------------------------------------------------------- */
/*  Chat / tool-use (chat rail)                                                */
/* -------------------------------------------------------------------------- */

/**
 * One tool call. `id` is the provider's own identifier for this specific
 * invocation.
 *
 * Anthropic correlates a tool_result to its tool_use by `tool_use_id`, and the
 * ids must be unique within a turn. Keying off the tool NAME breaks the moment
 * the model calls one tool twice in a turn (two blocks with the same id, and
 * two results that cannot be told apart). Gemini correlates by name and ignores
 * this field.
 */
export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
};

export type ToolResponse = {
  name: string;
  response: Record<string, unknown>;
  /** echoes the matching ToolCall.id — required by Anthropic, unused by Gemini */
  id?: string;
};

export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "model"; text: string }
  | {
      role: "model";
      calls: ToolCall[];
      /** the provider's verbatim model turn, echoed back unchanged (Gemini 3
       *  requires the original functionCall parts, incl. thought signatures;
       *  Anthropic requires thinking blocks back on the same model) */
      raw?: unknown;
    }
  | { role: "tool"; responses: ToolResponse[] };

export type ToolDeclaration = {
  name: string;
  description: string;
  /** JSON Schema for the parameters object. */
  parameters: Record<string, unknown>;
};

export type ChatArgs = {
  model: string;
  system: string;
  turns: ChatTurn[];
  tools: ToolDeclaration[];
};

export type ChatStep =
  | { kind: "text"; text: string }
  | {
      kind: "calls";
      calls: ToolCall[];
      /** provider's raw model turn, to be echoed back verbatim next call */
      raw?: unknown;
    };

/** A provider-specific implementation. Rate-limit backoff is handled by the caller. */
export interface LlmAdapter {
  name: ProviderName;
  generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult>;
  /** One assistant turn: either free text, or a batch of tool calls. */
  chatTurn(args: ChatArgs): Promise<ChatStep>;
}
