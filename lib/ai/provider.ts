/**
 * lib/ai/provider.ts — the model boundary.
 *
 * Everything the app needs from an LLM goes through `runStructured()` (structured
 * JSON) or `runChatTurn()` (tool use). Both:
 *   1. pick the provider from LLM_PROVIDER and the model from the role,
 *   2. reserve every outbound call against a shared CallBudget and log it,
 *   3. retry on HTTP 429 / transient 5xx with exponential backoff — but never
 *      past the budget,
 *   4. (runStructured) parse with the Zod schema, retrying ONCE with the error
 *      fed back, again only if the budget allows.
 *
 * The transport backoff, the Zod-validation retry, and the caller's own retry
 * (e.g. compose's post-validation retry) all draw from the ONE budget, so a
 * single "Plan my day" click can never exceed its cap (default 3 for compose).
 */

import "server-only";
import { z } from "zod";
import { activeProvider, modelFor, type ModelRole, type ProviderName } from "./models";
import { BUDGET, CallBudget, DailyQuotaError, classifyRateError } from "./budget";
import type {
  ChatStep,
  ChatTurn,
  InputFile,
  LlmAdapter,
  ToolDeclaration,
} from "./adapters/types";

export type { InputFile } from "./adapters/types";

export { CallBudget, ModelBudgetError, DailyQuotaError, dailyQuotaResetHint } from "./budget";

export type ChatMessage = { role: "user" | "model"; content: string };

export type RunStructuredArgs<T> = {
  role: ModelRole;
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Files sent WITH the prompt in the same call (e.g. a timetable PDF). */
  files?: InputFile[];
  /** Name for the schema / forced tool. Defaults to "result". */
  schemaName?: string;
  /** Short label for logs, e.g. "compose". Defaults to `role`. */
  purpose?: string;
  /** Shared outbound-call ceiling. One is created per call if omitted. */
  budget?: CallBudget;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CallCtx = {
  budget: CallBudget;
  provider: ProviderName;
  model: string;
  purpose: string;
};

/**
 * Run `fn`, reserving one budget call per attempt and logging it. Retries on
 * 429 / transient 5xx with exponential backoff, but stops the moment the budget
 * is spent (throwing the last transport error or a ModelBudgetError).
 */
async function withBudget<T>(ctx: CallCtx, fn: () => Promise<T>): Promise<T> {
  const { budget, provider, model, purpose } = ctx;
  for (;;) {
    const n = budget.claim(); // throws ModelBudgetError when exhausted
    console.log(`[ai] → ${provider}/${model} · ${purpose} · call ${n}/${budget.max}`);
    const started = Date.now();
    try {
      const out = await fn();
      console.log(`[ai] ← ${provider}/${model} · ${purpose} · ok ${Date.now() - started}ms`);
      return out;
    } catch (err) {
      const kind = classifyRateError(err);
      const ms = Date.now() - started;

      if (kind === "rpd") {
        console.log(`[ai] ✗ ${provider}/${model} · ${purpose} · DAILY QUOTA exhausted`);
        throw new DailyQuotaError(model);
      }
      if (kind == null) {
        console.log(`[ai] ✗ ${provider}/${model} · ${purpose} · ${ms}ms · ${(err as Error).message?.slice(0, 120)}`);
        throw err;
      }
      if (budget.remaining <= 0) {
        console.log(`[ai] ✗ ${provider}/${model} · ${purpose} · ${kind} · budget spent, giving up`);
        throw err;
      }
      const baseMs = kind === "rpm" ? 3000 : 1000;
      const backoff = Math.min(40000, baseMs * 2 ** (budget.spent - 1));
      const wait = backoff / 2 + Math.random() * (backoff / 2);
      console.log(
        `[ai] ⟳ ${provider}/${model} · ${purpose} · ${kind} · backoff ${Math.round(wait)}ms (${budget.remaining} call(s) left)`,
      );
      await sleep(wait);
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
  files,
  schemaName = "result",
  purpose,
  budget,
}: RunStructuredArgs<T>): Promise<T> {
  const provider = activeProvider();
  const model = modelFor(role, provider);
  const adapter = await getAdapter(provider);
  const jsonSchema = jsonSchemaFor(schema);
  const label = purpose ?? role;
  const b = budget ?? new CallBudget(2, label);

  const convo: ChatMessage[] = [...messages];

  for (let attempt = 1; ; attempt++) {
    const { text, usage } = await withBudget(
      { budget: b, provider, model, purpose: attempt === 1 ? label : `${label}:zod-retry` },
      () =>
        adapter.generateJson({
          model,
          system,
          messages: convo,
          // Only the first attempt carries the file; the Zod-retry turn appends
          // to the same conversation, and re-sending the PDF would double the
          // input tokens for nothing.
          files: attempt === 1 ? files : undefined,
          jsonSchema,
          schemaName,
        }),
    );
    if (usage) {
      console.log(`[ai]   ${label} tokens — in ${usage.inputTokens} / out ${usage.outputTokens}`);
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

    if (b.remaining <= 0) {
      throw new StructuredOutputError(undefined, issues);
    }

    convo.push({ role: "model", content: text.slice(0, 4000) });
    convo.push({
      role: "user",
      content:
        `That response did not match the required schema. Problems: ${issues}. ` +
        `Reply again with ONLY a single JSON object that satisfies the schema.`,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Chat rail — one assistant turn (text or tool calls)               */
/* ------------------------------------------------------------------ */

export async function runChatTurn(args: {
  role: ModelRole;
  system: string;
  turns: ChatTurn[];
  tools: ToolDeclaration[];
  budget?: CallBudget;
}): Promise<ChatStep> {
  const provider = activeProvider();
  const model = modelFor(args.role, provider);
  const adapter = await getAdapter(provider);
  const b = args.budget ?? new CallBudget(BUDGET.chatTurn, "chat-turn");
  return withBudget({ budget: b, provider, model, purpose: "chat-turn" }, () =>
    adapter.chatTurn({ model, system: args.system, turns: args.turns, tools: args.tools }),
  );
}
