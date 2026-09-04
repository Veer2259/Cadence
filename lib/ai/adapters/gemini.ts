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
import type {
  ChatArgs,
  ChatStep,
  ChatTurn,
  GenerateJsonArgs,
  GenerateJsonResult,
  LlmAdapter,
} from "./types";

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
  const { model, system, messages, files, jsonSchema, schemaName } = args;

  // Files attach to the FIRST user message so the document and the instruction
  // describing how to read it arrive in the same call.
  const contents = messages.map((m, i) => ({
    role: m.role,
    parts:
      i === 0 && m.role === "user" && files?.length
        ? [
            ...files.map((f) => ({
              inlineData: { mimeType: f.mediaType, data: f.data },
            })),
            { text: m.content },
          ]
        : [{ text: m.content }],
  }));

  const res = await genai().models.generateContent({
    model,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contents: contents as any,
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

/* ------------------------------------------------------------------ */
/*  chat / tool-use                                                    */
/* ------------------------------------------------------------------ */

function turnsToContents(turns: ChatTurn[]): unknown[] {
  return turns.map((t) => {
    if (t.role === "user") return { role: "user", parts: [{ text: t.text }] };
    if (t.role === "tool") {
      return {
        role: "user",
        parts: t.responses.map((r) => ({
          functionResponse: { name: r.name, response: r.response },
        })),
      };
    }
    if ("calls" in t) {
      // Echo Gemini's own model turn back unchanged — it carries the
      // thought_signature parts that Gemini 3 requires for tool continuity.
      if (t.raw) return t.raw;
      return {
        role: "model",
        parts: t.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
      };
    }
    return { role: "model", parts: [{ text: t.text }] };
  });
}

async function chatTurn(args: ChatArgs): Promise<ChatStep> {
  const res = await genai().models.generateContent({
    model: args.model,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contents: turnsToContents(args.turns) as any,
    config: {
      systemInstruction: args.system,
      temperature: 0.5,
      tools: [
        {
          functionDeclarations: args.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters,
          })),
        },
      ],
    },
  });

  const calls = res.functionCalls ?? [];
  if (calls.length > 0) {
    return {
      kind: "calls",
      calls: calls.map((c) => ({
        name: c.name ?? "",
        args: (c.args ?? {}) as Record<string, unknown>,
      })),
      raw: res.candidates?.[0]?.content,
    };
  }
  return { kind: "text", text: res.text ?? "" };
}

export const adapter: LlmAdapter = { name: "gemini", generateJson, chatTurn };
