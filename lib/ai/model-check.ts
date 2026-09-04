/**
 * lib/ai/model-check.ts — validate every configured model id against the
 * provider's own model list at boot.
 *
 * A model id that does not exist fails as a 404 buried inside whichever mode
 * happened to use it, days after the typo. This turns that into one loud line
 * in the server log at startup.
 *
 * Diagnostic only: it never throws and never blocks the app from running. A
 * dead network or a missing key means "could not check", not "refuse to boot".
 */

import { activeProvider, configuredModels, type ProviderName } from "./models";

const GEMINI_LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_LIST_URL = "https://api.anthropic.com/v1/models";
/** Required on every Anthropic REST call. */
const ANTHROPIC_VERSION = "2023-06-01";
/** register() blocks the server from serving, so this is deliberately short. */
const TIMEOUT_MS = 5000;

export type ModelCheck = {
  provider: ProviderName;
  /** false when we could not reach the provider — NOT the same as "invalid" */
  checked: boolean;
  reason?: string;
  ok: { role: string; id: string }[];
  bad: { role: string; id: string; source: string; suggestions: string[] }[];
};

/** Model ids that support generateContent, per the Gemini ListModels API. */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const out: string[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url =
      `${GEMINI_LIST_URL}?pageSize=200` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
      `&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`ListModels returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of json.models ?? []) {
      if ((m.supportedGenerationMethods ?? []).includes("generateContent")) {
        out.push(m.name.replace(/^models\//, ""));
      }
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

/**
 * Model ids on this key, from GET /v1/models.
 *
 * The Models API is GA — no beta header — and pages with `has_more` / `last_id`.
 * Each entry carries `id`, `display_name`, `created_at`, and (since Mar 2026)
 * `max_input_tokens`, `max_tokens` and `capabilities`; we only need the ids.
 */
export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const out: string[] = [];
  let afterId = "";
  for (let page = 0; page < 5; page++) {
    const url =
      `${ANTHROPIC_LIST_URL}?limit=100` +
      (afterId ? `&after_id=${encodeURIComponent(afterId)}` : "");
    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GET /v1/models returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: { id: string }[];
      has_more?: boolean;
      last_id?: string | null;
    };
    for (const m of json.data ?? []) out.push(m.id);
    if (!json.has_more || !json.last_id) break;
    afterId = json.last_id;
  }
  return out;
}

/** Cheap similarity, so a typo gets a "did you mean" rather than a shrug. */
function nearest(target: string, pool: string[], n = 3): string[] {
  const score = (a: string) => {
    let shared = 0;
    const parts = target.split(/[-.]/);
    for (const p of parts) if (p && a.includes(p)) shared += p.length;
    return shared;
  };
  return [...pool]
    .map((id) => ({ id, s: score(id) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.id);
}

export async function checkModelIds(): Promise<ModelCheck> {
  const provider = activeProvider();
  const configured = configuredModels(provider);
  const base: ModelCheck = { provider, checked: false, ok: [], bad: [] };

  const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  const key = process.env[keyName];
  if (!key || !key.trim()) {
    return { ...base, reason: `${keyName} is not set` };
  }

  let available: string[];
  try {
    available =
      provider === "gemini"
        ? await listGeminiModels(key.trim())
        : await listAnthropicModels(key.trim());
  } catch (e) {
    return { ...base, reason: e instanceof Error ? e.message : "model list failed" };
  }

  const set = new Set(available);
  const check: ModelCheck = { provider, checked: true, ok: [], bad: [] };
  for (const c of configured) {
    if (set.has(c.id)) {
      check.ok.push({ role: c.role, id: c.id });
    } else {
      check.bad.push({
        role: c.role,
        id: c.id,
        source: c.source,
        suggestions: nearest(c.id, available),
      });
    }
  }
  return check;
}

/** Run the check and print it. Never throws. */
export async function reportModelIds(): Promise<void> {
  let check: ModelCheck;
  try {
    check = await checkModelIds();
  } catch {
    console.warn("[models] startup check failed to run");
    return;
  }

  if (!check.checked) {
    console.warn(`[models] not verified (${check.provider}): ${check.reason}`);
    return;
  }

  if (check.bad.length === 0) {
    console.log(
      `[models] ✓ all ${check.ok.length} configured ${check.provider} model ids exist: ` +
        check.ok.map((o) => `${o.role}=${o.id}`).join(", "),
    );
    return;
  }

  console.warn(
    `\n[models] ✗ ${check.bad.length} configured model id(s) do NOT exist on this ${check.provider} key.\n` +
      `          Calls using them will fail with a 404 at request time.`,
  );
  for (const b of check.bad) {
    const from = b.source === "env" ? " (from an env override)" : "";
    const did = b.suggestions.length ? ` — did you mean: ${b.suggestions.join(", ")}?` : "";
    console.warn(`          role "${b.role}": "${b.id}"${from}${did}`);
  }
  if (check.ok.length) {
    console.warn(`          ok: ${check.ok.map((o) => `${o.role}=${o.id}`).join(", ")}\n`);
  }
}
