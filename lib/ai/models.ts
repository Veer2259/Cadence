/**
 * lib/ai/models.ts — the ONE place model IDs live. Swap here, nowhere else.
 *
 * Provider is chosen at runtime by the LLM_PROVIDER env var ("gemini" | "anthropic").
 *
 * Gemini model IDs verified against https://ai.google.dev/gemini-api/docs/models
 * (Aug 2026): gemini-3.7-flash is the current stable flagship Flash; the current
 * lightweight tier is gemini-3.5-flash-lite.
 *
 * Anthropic model IDs are checked at boot against GET /v1/models — see
 * lib/ai/model-check.ts. They have NOT been verified against a live key yet
 * (there was none when they were written), so the boot check is the thing that
 * confirms them: watch for the [models] line on the first deploy.
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
export type ModelRole = "compose" | "capture" | "reason" | "chat";

const MODELS: Record<ProviderName, Record<ModelRole, string>> = {
  gemini: {
    // The strongest this key can actually call — see `reason` below.
    chat: "gemini-3.7-flash",
    // Flagship Flash — compose and the week commentary.
    compose: "gemini-3.7-flash",
    // Lightweight — capture parsing, classification, debrief summary.
    capture: "gemini-3.5-flash-lite",
    // Breakdown only. "Strongest available" is constrained by what this
    // project can actually CALL: every Pro model (gemini-2.5-pro,
    // gemini-3.1-pro-preview, gemini-pro-latest) reports 0/0 quota here, so
    // 3.7 Flash is the ceiling. Verified against ListModels, not guessed.
    reason: "gemini-3.7-flash",
  },
  anthropic: {
    /**
     * The assistant rail — the primary way to operate the app, so it runs on
     * every message.
     *
     * Haiku, not Opus. It was briefly on claude-opus-5 on the reasoning that
     * routing ~28 tools and telling a brain dump from an instruction is the
     * hardest judgement in the app. It is, but the cost per query did not
     * justify it: this fires on every single message, including "I'm fried".
     *
     * The evidence says a small model handles it. Every routing case was
     * verified on gemini-3.5-flash-lite — the weakest model configured
     * anywhere here — including the one that matters most, an UNMARKED brain
     * dump recognised as a dump rather than acted on as instructions.
     *
     * If routing quality does slip, pin it back without a code change:
     *   ANTHROPIC_CHAT_MODEL=claude-opus-5
     */
    chat: "claude-haiku-4-5",
    // Mid-tier for the daily planner: compose runs every day.
    compose: "claude-sonnet-5",
    // Small and fast — capture parsing, classification, debrief summary.
    // NOTE: the id is "claude-haiku-4-5", with NO date suffix. This previously
    // read "claude-haiku-4-5-20251001"; date-suffixed ids are not valid model
    // strings and would have 404'd on first use — exactly the failure the boot
    // check exists to catch.
    capture: "claude-haiku-4-5",
    // Breakdown, and the timetable parse: reads a table and refuses to guess.
    reason: "claude-sonnet-5",
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

export const MODEL_ROLES: ModelRole[] = ["compose", "capture", "reason", "chat"];

/** Every model id this process would actually use, and where it came from. */
export function configuredModels(
  provider: ProviderName = activeProvider(),
): { role: ModelRole; id: string; source: "env" | "default" }[] {
  return MODEL_ROLES.map((role) => {
    const env = envOverride(provider, role);
    return {
      role,
      id: env ?? MODELS[provider][role],
      source: env ? ("env" as const) : ("default" as const),
    };
  });
}
