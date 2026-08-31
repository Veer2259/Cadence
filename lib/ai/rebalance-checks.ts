/**
 * lib/ai/rebalance-checks.ts — the pure guards that make completed-block
 * preservation exactly right (SPEC 6.3). No DB, no model, no server-only, so it
 * can be unit tested.
 */

import {
  istMinutesOfDay,
  minutesToHm,
  type Window,
} from "@/lib/time";
import { validatePlan } from "@/lib/ai/validate";
import type { PlanBlock, PlanResult } from "@/lib/ai/schemas";
import type { ComposeInput } from "@/lib/ai/compose-types";
import type { Block } from "@/db/schema";

export type Energy = "sharp" | "ok" | "fried";

export function hm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** End minute of a block, treating a rolled-past-midnight end as end-of-day. */
export function clampEnd(b: Pick<Block, "startAt" | "endAt">): number {
  const s = istMinutesOfDay(b.startAt);
  let e = istMinutesOfDay(b.endAt);
  if (e <= s) e = 1440;
  return e;
}

/** A DB block that already happened, in the schema the model / ribbon use. */
export function blockToPlanBlock(b: Block): PlanBlock {
  return {
    taskId: b.taskId,
    title: b.title,
    start: minutesToHm(istMinutesOfDay(b.startAt)),
    end: minutesToHm(clampEnd(b)),
    kind: b.kind,
    category: b.category,
    estimateMin: b.actualMin ?? b.estimateMin,
    reason: b.reason,
  };
}

/** Clip weekly windows so nothing starts before `fromMin`. */
export function clipFrom(windows: Window[], fromMin: number): Window[] {
  const out: Window[] = [];
  for (const [a, b] of windows) {
    const s = Math.max(hm(a), fromMin);
    const e = hm(b);
    if (e - s >= 5) out.push([minutesToHm(s), minutesToHm(e)]);
  }
  return out;
}

/**
 * True only if every preserved block appears in `combinedBlocks` byte-for-byte
 * (same slot, same title, same kind). The model must never move or drop one.
 */
export function preservedIntact(
  preserved: PlanBlock[],
  combinedBlocks: PlanBlock[],
): boolean {
  return preserved.every((p) =>
    combinedBlocks.some(
      (c) =>
        c.title === p.title &&
        c.start === p.start &&
        c.end === p.end &&
        c.kind === p.kind &&
        c.taskId === p.taskId,
    ),
  );
}

export function checkRebalance(
  newPlan: PlanResult,
  ctx: {
    preservedPlanBlocks: PlanBlock[];
    fullDayContext: ComposeInput;
    replanFromMin: number;
    energy: Energy;
    completedTaskIds: Set<string>;
  },
): string[] {
  const combined: PlanResult = {
    blocks: [...ctx.preservedPlanBlocks, ...newPlan.blocks],
    overflow: newPlan.overflow,
    calibrationNote: newPlan.calibrationNote,
  };

  const v = validatePlan(combined, ctx.fullDayContext);

  if (!preservedIntact(ctx.preservedPlanBlocks, combined.blocks)) {
    v.push("a done/partial block was moved or dropped");
  }

  for (const b of newPlan.blocks) {
    const s = hm(b.start);
    if (Number.isFinite(s) && s < ctx.replanFromMin - 1) {
      v.push(`"${b.title}" starts at ${b.start}, before the replan time`);
    }
    if (ctx.energy === "fried" && b.category === "deep") {
      v.push(`"${b.title}" is deep work but energy is "fried" — move it to overflow`);
    }
    if (b.kind === "task" && b.taskId && ctx.completedTaskIds.has(b.taskId)) {
      v.push(`"${b.title}" re-plans a task that is already done`);
    }
    for (const p of ctx.preservedPlanBlocks) {
      if (hm(b.start) < hm(p.end) && hm(p.start) < hm(b.end)) {
        v.push(`"${b.title}" overlaps the completed block "${p.title}"`);
      }
    }
  }

  return v;
}
