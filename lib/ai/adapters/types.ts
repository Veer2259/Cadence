import type { ChatMessage } from "../provider";
import type { ProviderName } from "../models";

export type GenerateJsonArgs = {
  model: string;
  system: string;
  messages: ChatMessage[];
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

export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "model"; text: string }
  | {
      role: "model";
      calls: { name: string; args: Record<string, unknown> }[];
      /** the provider's verbatim model turn, echoed back unchanged (Gemini 3
       *  requires the original functionCall parts, incl. thought signatures) */
      raw?: unknown;
    }
  | { role: "tool"; responses: { name: string; response: Record<string, unknown> }[] };

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
      calls: { name: string; args: Record<string, unknown> }[];
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
