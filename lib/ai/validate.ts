/**
 * lib/ai/validate.ts — post-validation checks run IN CODE, not in the prompt
 * (SPEC section 6.1). Models drift on arithmetic.
 *
 * Verifies: no block overlaps another; no block outside a work window; no block
 * collides with a commitment or protected block; total scheduled minutes <=
 * dailyCapMin; every referenced taskId existed in the input.
 *
 * Returns a list of human-readable violations ([] = clean).
 */

import { hmToMinutes, minutesToHm, overlaps, type Interval } from "@/lib/time";
import type { PlanResult } from "./schemas";
import type { ComposeInput } from "./compose-types";

/** [start,end] on a 24h clock -> 1-2 minute intervals, splitting midnight wraps. */
function clockToIntervals(pairs: [string, string][]): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of pairs) {
    let s: number;
    let e: number;
    try {
      s = hmToMinutes(a);
      e = hmToMinutes(b);
    } catch {
      continue; // malformed config — not the plan's fault, skip
    }
    if (e > s) {
      out.push({ start: s, end: e });
    } else if (e < s) {
      out.push({ start: s, end: 1440 });
      out.push({ start: 0, end: e });
    }
  }
  return out;
}

export function validatePlan(plan: PlanResult, input: ComposeInput): string[] {
  const v: string[] = [];
  const taskIds = new Set(input.tasks.map((t) => t.id));

  type B = { n: number; start: number; end: number; kind: string; title: string };
  const blocks: B[] = [];

  plan.blocks.forEach((b, idx) => {
    const n = idx + 1;
    let s: number;
    let e: number;
    try {
      s = hmToMinutes(b.start);
      e = hmToMinutes(b.end);
    } catch {
      v.push(`block ${n} "${b.title}": start/end is not HH:mm`);
      return;
    }
    if (e <= s) {
      v.push(`block ${n} "${b.title}": ends at or before it starts`);
      return;
    }
    blocks.push({ n, start: s, end: e, kind: b.kind, title: b.title });
  });

  // --- overlaps between blocks ---
  const byStart = [...blocks].sort((a, b) => a.start - b.start);
  for (let i = 1; i < byStart.length; i++) {
    if (byStart[i].start < byStart[i - 1].end) {
      v.push(`"${byStart[i - 1].title}" and "${byStart[i].title}" overlap`);
    }
  }

  // --- inside a working window ---
  const windows = clockToIntervals(input.workWindows);
  for (const b of blocks) {
    const inside = windows.some((w) => b.start >= w.start && b.end <= w.end);
    if (!inside) {
      v.push(
        `"${b.title}" (${minutesToHm(b.start)}–${minutesToHm(b.end)}) is outside the working windows`,
      );
    }
  }

  // --- commitment / protected collisions ---
  const commitments = clockToIntervals(
    input.commitments.map((c) => [c.start, c.end] as [string, string]),
  );
  const protectedIv = clockToIntervals(
    input.protectedBlocks.map((p) => [p.start, p.end] as [string, string]),
  );
  for (const b of blocks) {
    const iv: Interval = { start: b.start, end: b.end };
    // A `fixed` block *is* a commitment, so it is allowed to coincide with one.
    if (b.kind !== "fixed" && commitments.some((c) => overlaps(iv, c))) {
      v.push(`"${b.title}" is scheduled over a fixed commitment`);
    }
    if (protectedIv.some((p) => overlaps(iv, p))) {
      v.push(`"${b.title}" is scheduled over a protected block`);
    }
  }

  // --- daily cap (time inside fixed commitments counts) ---
  const scheduled = blocks.reduce((n, b) => n + (b.end - b.start), 0);
  if (scheduled > input.dailyCapMin) {
    v.push(
      `total scheduled time ${scheduled} min exceeds the daily cap of ${input.dailyCapMin} min`,
    );
  }

  // --- taskId integrity ---
  plan.blocks.forEach((b, idx) => {
    if (b.kind === "task") {
      if (!b.taskId) {
        v.push(`block ${idx + 1} "${b.title}": task block is missing a taskId`);
      } else if (!taskIds.has(b.taskId)) {
        v.push(`block ${idx + 1} "${b.title}": taskId is not one of the input tasks`);
      }
    }
  });
  plan.overflow.forEach((o, idx) => {
    if (!taskIds.has(o.taskId)) {
      v.push(`overflow item ${idx + 1}: taskId "${o.taskId}" is not one of the input tasks`);
    }
  });

  return v;
}
