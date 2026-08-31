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

/** A provider-specific implementation. Rate-limit backoff is handled by the caller. */
export interface LlmAdapter {
  name: ProviderName;
  generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult>;
}
