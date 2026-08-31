/**
 * lib/ai/budget.ts — a hard cap on outbound model calls for one logical action.
 *
 * One "Plan my day" click used to be able to fan out to 24 HTTP calls:
 *   composePlan (2 runStructured) × runStructured (2 Zod retries) × withBackoff (6 tries)
 * A single CallBudget threaded through all three layers makes the ceiling real.
 * Every outbound request calls `claim()` first; when the budget is gone it
 * throws instead of calling the API.
 */

export class ModelBudgetError extends Error {
  readonly code = "MODEL_BUDGET";
  constructor(
    readonly spent: number,
    readonly max: number,
    readonly label: string,
  ) {
    super(
      `Model-call budget for "${label}" exhausted after ${spent} of ${max} calls — giving up.`,
    );
    this.name = "ModelBudgetError";
  }
}

/**
 * A 429 caused by the per-DAY request quota (Gemini free tier: 20/day on the
 * Flash models, 500/day on Flash-Lite). Retrying is pointless — it won't reset
 * for hours — so this is thrown immediately, not backed off.
 */
export class DailyQuotaError extends Error {
  readonly code = "DAILY_QUOTA";
  constructor(readonly model: string) {
    super(`Daily request quota for ${model} is exhausted.`);
    this.name = "DailyQuotaError";
  }
}

export type RateKind = "rpd" | "rpm" | "5xx" | null;

/**
 * Classify a transport error from a model provider:
 *   "rpd" — 429 from the per-DAY quota (do NOT retry; won't reset for hours)
 *   "rpm" — 429 from the per-MINUTE rate limit (a short backoff helps)
 *   "5xx" — transient server error (a short backoff helps)
 *   null  — not retryable
 */
export function classifyRateError(err: unknown): RateKind {
  if (err instanceof ModelBudgetError || err instanceof DailyQuotaError) return null;
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: number; code?: number | string; message?: string };
  const status = typeof e.status === "number" ? e.status : Number(e.code);
  // A provider ApiError's message usually carries the full JSON body, which
  // names the quota metric (…PerDay… vs …PerMinute…).
  let blob = String(e.message ?? "");
  try {
    blob += " " + JSON.stringify(err);
  } catch {
    /* circular — message is enough */
  }

  const is429 =
    status === 429 ||
    /\b429\b|RESOURCE_EXHAUSTED|rate limit|too many requests|\bquota\b/i.test(blob);
  if (is429) {
    return /per[\s_-]?day|perday|requests? per day|RequestsPerDay|daily limit|\bper day\b/i.test(blob)
      ? "rpd"
      : "rpm";
  }
  if (
    status === 500 ||
    status === 503 ||
    /\b50[03]\b|UNAVAILABLE|overloaded|high demand/i.test(blob)
  ) {
    return "5xx";
  }
  return null;
}

/** Rough "resets in ~Nh" — Gemini free-tier quotas reset at midnight US Pacific. */
export function dailyQuotaResetHint(now = new Date()): string {
  const ptNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  );
  const nextMidnight = new Date(ptNow);
  nextMidnight.setHours(24, 0, 0, 0);
  const hours = Math.max(1, Math.round((nextMidnight.getTime() - ptNow.getTime()) / 3_600_000));
  return `resets at midnight US Pacific, about ${hours}h from now`;
}

export class CallBudget {
  spent = 0;

  constructor(
    readonly max: number,
    readonly label: string,
  ) {}

  get remaining(): number {
    return Math.max(0, this.max - this.spent);
  }

  /**
   * Reserve one outbound call. Returns the 1-based call number. Throws
   * ModelBudgetError when nothing is left — the caller must not hit the API.
   */
  claim(): number {
    if (this.spent >= this.max) {
      throw new ModelBudgetError(this.spent, this.max, this.label);
    }
    this.spent += 1;
    return this.spent;
  }
}

/** Per-action ceilings. Compose is the one the SPEC caps hard. */
export const BUDGET = {
  /** initial call + Zod retry + one post-validation retry, no more */
  compose: 3,
  capture: 2,
  week: 2,
  /** per assistant turn inside the chat tool loop */
  chatTurn: 2,
} as const;
