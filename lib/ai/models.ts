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
export type ModelRole = "compose" | "capture" | "reason";

const MODELS: Record<ProviderName, Record<ModelRole, string>> = {
  gemini: {
    // Flagship Flash — compose, rebalance, week commentary, chat rail.
    compose: "gemini-3.7-flash",
    // Lightweight — capture parsing, classification, debrief summary.
    capture: "gemini-3.5-flash-lite",
    // Strongest available — breakdown only. It runs a few times a quarter, so
    // it can afford the best model and a tight daily cap; compose, which runs
    // every day, stays on the cheaper one.
    reason: "gemini-3.7-pro",
  },
  anthropic: {
    // SPEC section 6 strings.
    compose: "claude-sonnet-5",
    capture: "claude-haiku-4-5-20251001",
    reason: "claude-opus-5",
  },
};

/**
 * Optional env pins, for riding out a model outage without a code change.
 * Read at CALL time (not module load) so a running process picks up the right
 * value and there is no import-order ambiguity — but note that `next dev` still
 * needs a restart to see a new line in .env.local.
 */
function envOverride(provider: ProviderName, role: ModelRole): string | undefined {
  const key = `${provider.toUpperCase()}_${role.toUpperCase()}_MODEL`;
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function modelFor(role: ModelRole, provider: ProviderName = activeProvider()): string {
  return envOverride(provider, role) ?? MODELS[provider][role];
}
