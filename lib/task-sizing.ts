/**
 * lib/task-sizing.ts — a proposed task must fit one sitting.
 *
 * Anything larger is SPLIT into several tasks rather than proposed as one, so
 * the review list never contains an item the day cannot hold. Splitting here,
 * in code, rather than asking the model to do it in the prompt: the prompt is
 * advisory and the model drifts on arithmetic (SPEC 6.1 makes the same argument
 * for the post-validation checks).
 */

/** A single sitting, before the day profile narrows it further. */
export const SITTING_MIN_MIN = 30;
export const SITTING_MAX_MIN = 120;

export type SizingBounds = {
  /** day_profile.min_block_min */
  minBlockMin: number;
  /** day_profile.max_block_min */
  maxBlockMin: number;
};

/**
 * The effective floor and ceiling for one proposed task.
 *
 * The day profile is the person's own statement about how they work, so it
 * NARROWS the 30–120 sitting range rather than being overridden by it: a
 * ceiling of 90 means 90, and a floor of 45 means 45. When the two ranges do
 * not overlap at all, the profile wins — it describes a real constraint on the
 * day, and 30–120 is only a default.
 */
export function sittingBounds(b: SizingBounds): { min: number; max: number } {
  const min = Math.max(SITTING_MIN_MIN, b.minBlockMin);
  const max = Math.min(SITTING_MAX_MIN, b.maxBlockMin);
  if (min > max) {
    // Profile bounds sit entirely outside the sitting range. Honour the
    // profile; a task that cannot be scheduled is worse than a long one.
    return { min: b.minBlockMin, max: Math.max(b.minBlockMin, b.maxBlockMin) };
  }
  return { min, max };
}

/**
 * Split one estimate into sitting-sized parts.
 *
 * Parts are as EVEN as the bounds allow, because a 150-minute task split into
 * 120 + 30 puts a scrap at the end that reads like an afterthought; 75 + 75
 * reads like two sittings. The last part is never left below the floor — the
 * remainder is spread across the others instead of being proposed as a stub.
 */
export function splitEstimate(estimateMin: number, bounds: SizingBounds): number[] {
  const { min, max } = sittingBounds(bounds);
  const total = Math.max(1, Math.round(estimateMin));

  // Already one sitting, or too small to be worth splitting: round up to the
  // floor rather than proposing something the planner cannot place.
  if (total <= max) return [Math.max(min, total)];

  const parts = Math.ceil(total / max);
  const even = Math.round(total / parts);
  const size = Math.max(min, Math.min(max, even));

  const out: number[] = [];
  let left = total;
  for (let i = 0; i < parts - 1; i++) {
    out.push(size);
    left -= size;
  }
  // Whatever is left becomes the final part, floored so it is still placeable.
  out.push(Math.max(min, left));
  return out;
}

export type SizedCandidate<T> = T & { title: string; estimateMin: number };

/**
 * Apply the split to a list of proposed candidates.
 *
 * A split task keeps its fields and gains a "(1/3)" suffix on the title, so the
 * review list shows plainly that one proposal became three — an unlabelled
 * triplet of identical titles looks like the model repeated itself.
 */
export function sizeCandidates<T extends { title: string; estimateMin: number }>(
  candidates: T[],
  bounds: SizingBounds,
): T[] {
  const out: T[] = [];
  for (const c of candidates) {
    const parts = splitEstimate(c.estimateMin, bounds);
    if (parts.length === 1) {
      out.push({ ...c, estimateMin: parts[0] });
      continue;
    }
    parts.forEach((min, i) => {
      out.push({
        ...c,
        title: `${c.title} (${i + 1}/${parts.length})`,
        estimateMin: min,
      });
    });
  }
  return out;
}
