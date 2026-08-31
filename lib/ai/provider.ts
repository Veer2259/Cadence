/**
 * lib/ai/provider.ts — the model boundary.
 *
 * Everything the app needs from an LLM goes through `runStructured()`. It:
 *   1. picks the provider from LLM_PROVIDER and the model from the role,
 *   2. asks the provider for JSON constrained to a schema derived from the Zod
 *      schema, retrying on HTTP 429 with exponential backoff (free-tier RPM),
 *   3. parses the reply with that same Zod schema, retrying ONCE with the
 *      validation error fed back (SPEC section 6),
 *   4. throws a typed StructuredOutputError if it still can't get valid output.
 *
 * The transport backoff and the Zod-validation retry are deliberately separate.
 */

import "server-only";
import { z } from "zod";
import { activeProvider, modelFor, type ModelRole, type ProviderName } from "./models";
import type { LlmAdapter } from "./adapters/types";

export type ChatMessage = { role: "user" | "model"; content: string };

export type RunStructuredArgs<T> = {
  role: ModelRole;
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Name for the schema / forced tool. Defaults to "result". */
  schemaName?: string;
};

/** Thrown when the model will not produce output that matches the schema. */
export class StructuredOutputError extends Error {
  readonly code = "STRUCTURED_OUTPUT";
  constructor(
    message = "The planner returned something I couldn't read — try again.",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/* ------------------------------------------------------------------ */
/*  Transport backoff — HTTP 429 (rate limit) + transient 5xx          */
/* ------------------------------------------------------------------ */

function retryableStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: number; code?: number | string; message?: string };
  const status = typeof e.status === "number" ? e.status : Number(e.code);
  if (status === 429 || status === 500 || status === 503) return status;
  const msg = String(e.message ?? "");
  if (/\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(msg)) return 429;
  if (/\b50[03]\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) return 503;
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry `fn` on HTTP 429 (free-tier RPM) and transient 5xx with exponential
 * backoff + jitter. 429 gets a longer base delay than a passing 5xx spike.
 */
async function withBackoff<T>(
  fn: () => Promise<T>,
  { retries = 5, maxMs = 40000 }: { retries?: number; maxMs?: number } = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = retryableStatus(err);
      if (status == null || attempt >= retries) throw err;
      const baseMs = status === 429 ? 3000 : 1000;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const wait = backoff / 2 + Math.random() * (backoff / 2);
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[ai] ${status} — backing off ${Math.round(wait)}ms (attempt ${attempt + 1}/${retries})`,
        );
      }
      await sleep(wait);
      attempt += 1;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Adapter selection                                                  */
/* ------------------------------------------------------------------ */

let cachedAdapter: LlmAdapter | undefined;
let cachedFor: ProviderName | undefined;

async function getAdapter(provider: ProviderName): Promise<LlmAdapter> {
  if (cachedAdapter && cachedFor === provider) return cachedAdapter;
  const mod =
    provider === "gemini"
      ? await import("./adapters/gemini")
      : await import("./adapters/anthropic");
  cachedAdapter = mod.adapter;
  cachedFor = provider;
  return cachedAdapter;
}

/* ------------------------------------------------------------------ */
/*  runStructured                                                      */
/* ------------------------------------------------------------------ */

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export async function runStructured<T>({
  role,
  system,
  messages,
  schema,
  schemaName = "result",
}: RunStructuredArgs<T>): Promise<T> {
  const provider = activeProvider();
  const model = modelFor(role, provider);
  const adapter = await getAdapter(provider);
  const jsonSchema = jsonSchemaFor(schema);

  const convo: ChatMessage[] = [...messages];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const { text, usage } = await withBackoff(() =>
      adapter.generateJson({ model, system, messages: convo, jsonSchema, schemaName }),
    );

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[ai] ${provider}/${model} ${role} attempt ${attempt} — ${Date.now() - started}ms` +
          (usage ? ` — in ${usage.inputTokens} / out ${usage.outputTokens} tokens` : ""),
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      parsedJson = undefined;
    }

    const result = schema.safeParse(parsedJson);
    if (result.success) return result.data;

    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");

    if (attempt === 2) {
      throw new StructuredOutputError(undefined, issues);
    }

    // Feed the error back and try once more.
    convo.push({ role: "model", content: text.slice(0, 4000) });
    convo.push({
      role: "user",
      content:
        `That response did not match the required schema. Problems: ${issues}. ` +
        `Reply again with ONLY a single JSON object that satisfies the schema.`,
    });
  }

  // Unreachable — the loop either returns or throws.
  throw new StructuredOutputError();
}
