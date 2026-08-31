/**
 * lib/ai/models.ts — the ONE place model IDs live. Swap here, nowhere else.
 *
 * Provider is chosen at runtime by the LLM_PROVIDER env var ("gemini" | "anthropic").
 * Gemini model IDs verified against https://ai.google.dev/gemini-api/docs/models
 * (Aug 2026): gemini-3.7-flash is the current stable flagship Flash; the current
 * lightweight tier is gemini-3.5-flash-lite.
 */

export type ProviderName = "gemini" | "anthropic";

export function activeProvider(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (raw !== "gemini" && raw !== "anthropic") {
    throw new Error(`LLM_PROVIDER must be "gemini" or "anthropic", got "${raw}"`);
  }
  return raw;
}

/** Roles the app asks a model to play. Each maps to a model per provider. */
export type ModelRole = "compose" | "capture";

const MODELS: Record<ProviderName, Record<ModelRole, string>> = {
  gemini: {
    // Flagship Flash — compose, rebalance, week commentary, chat rail.
    compose: "gemini-3.7-flash",
    // Lightweight — capture parsing, classification, debrief summary.
    capture: "gemini-3.5-flash-lite",
  },
  anthropic: {
    // SPEC section 6 strings.
    compose: "claude-sonnet-5",
    capture: "claude-haiku-4-5-20251001",
  },
};

/** Optional env pins, for riding out a model outage without a code change. */
const ENV_OVERRIDE: Partial<Record<`${ProviderName}:${ModelRole}`, string | undefined>> = {
  "gemini:compose": process.env.GEMINI_COMPOSE_MODEL,
  "gemini:capture": process.env.GEMINI_CAPTURE_MODEL,
  "anthropic:compose": process.env.ANTHROPIC_COMPOSE_MODEL,
  "anthropic:capture": process.env.ANTHROPIC_CAPTURE_MODEL,
};

export function modelFor(role: ModelRole, provider: ProviderName = activeProvider()): string {
  return ENV_OVERRIDE[`${provider}:${role}`] || MODELS[provider][role];
}
