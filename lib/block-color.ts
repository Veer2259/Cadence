/**
 * Category → colour, for block bars, dots and week bars.
 *
 * The design calls these "bucket colours", but a block row is denormalised and
 * carries a CATEGORY, not a bucket id — deliberately, so a plan renders without
 * joins (SPEC §3). Mapping from category keeps that property; the alternative
 * is a join on every ribbon render to colour a 5px bar.
 *
 * `fixed` is keyed off block KIND rather than category, since a fixed
 * commitment is visually distinct regardless of what it is about.
 */

export type BlockCategory =
  | "deep"
  | "shallow"
  | "calls"
  | "admin"
  | "errand"
  | "personal";

const BY_CATEGORY: Record<BlockCategory, string> = {
  deep: "var(--color-bucket-growth)",
  shallow: "var(--color-bucket-ops)",
  calls: "var(--color-bucket-churn)",
  admin: "var(--color-bucket-ops)",
  errand: "var(--color-bucket-churn)",
  personal: "var(--color-bucket-personal)",
};

export const FIXED_COLOR = "var(--color-bucket-fixed)";

/** The hatched fill a fixed commitment gets instead of a flat bar. */
export const FIXED_HATCH =
  "repeating-linear-gradient(135deg, #B8AFA0 0 4px, #FDF8F0 4px 8px)";

export function blockColor(category: string, kind?: string): string {
  if (kind === "fixed") return FIXED_COLOR;
  if (kind === "break") return "var(--color-line)";
  return BY_CATEGORY[category as BlockCategory] ?? "var(--color-bucket-ops)";
}
