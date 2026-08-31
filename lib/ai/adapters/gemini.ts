/**
 * Gemini adapter — uses the unified @google/genai SDK's structured-output mode
 * (responseMimeType application/json + responseSchema).
 *
 * The Zod-derived JSON Schema is sanitised into the OpenAPI-ish dialect Gemini
 * accepts: uppercase type names, `nullable: true` instead of `type: [..,"null"]`,
 * and no `additionalProperties` / `$schema`.
 */

import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { GenerateJsonArgs, GenerateJsonResult, LlmAdapter } from "./types";

let client: GoogleGenAI | undefined;
function genai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

/** Recursively convert a draft-2020-12 JSON Schema into a Gemini responseSchema. */
function toGeminiSchema(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object") return {};
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // type, handling ["string","null"] -> STRING + nullable
  let type = src.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== "null");
    if (type.includes("null")) out.nullable = true;
    type = nonNull[0];
  }
  if (typeof type === "string" && TYPE_MAP[type]) out.type = TYPE_MAP[type];

  if (typeof src.description === "string") out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (typeof src.minLength === "number") out.minLength = String(src.minLength);
  if (typeof src.maxLength === "number") out.maxLength = String(src.maxLength);
  if (Array.isArray(src.required)) out.required = src.required;

  if (src.properties && typeof src.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      props[k] = toGeminiSchema(v);
    }
    out.properties = props;
    out.propertyOrdering = Object.keys(props);
  }
  if (src.items) out.items = toGeminiSchema(src.items);

  return out;
}

async function generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult> {
  const { model, system, messages, jsonSchema, schemaName } = args;

  const contents = messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const res = await genai().models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(jsonSchema),
      temperature: 0.4,
    },
  });

  const text = res.text ?? "";
  if (!text.trim()) {
    throw new Error(`Gemini returned an empty response for "${schemaName}".`);
  }

  const usage = res.usageMetadata
    ? {
        inputTokens: res.usageMetadata.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;

  return { text, usage };
}

export const adapter: LlmAdapter = { name: "gemini", generateJson };
