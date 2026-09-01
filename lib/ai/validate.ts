/**
 * lib/ai/validate.ts — post-validation checks run IN CODE, not in the prompt
 * (SPEC section 6.1). Models drift on arithmetic.
 *
 * The positional checks (overlap / work window / commitment / protected / cap)
 * live in `lib/plan-geometry.ts` so the drag + assistant-edit path shares the
 * exact same logic. This file adds the compose-only checks on top: every
 * referenced taskId existed in the input.
 *
 * Returns a list of human-readable violations ([] = clean).
 */

import { hmToMinutes, minutesToHm } from "@/lib/time";
import { checkDayGeometry, type GeoBlock } from "@/lib/plan-geometry";
import type { PlanResult } from "./schemas";
import type { ComposeInput } from "./compose-types";

export function validatePlan(plan: PlanResult, input: ComposeInput): string[] {
  const v: string[] = [];
  const taskIds = new Set(input.tasks.map((t) => t.id));

  const geoBlocks: GeoBlock[] = [];
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
    geoBlocks.push({ startMin: s, endMin: e, kind: b.kind, title: b.title });
  });

  // --- positional checks (shared with the drag / assistant-edit path) ---
  v.push(
    ...checkDayGeometry(geoBlocks, {
      workWindows: input.workWindows,
      commitments: input.commitments.map((c) => ({ start: c.start, end: c.end })),
      protectedBlocks: input.protectedBlocks,
      dailyCapMin: input.dailyCapMin,
    }),
  );

  // --- nothing scheduled into hours that have already passed ---
  // The model is told this too, but models drift on arithmetic; this is the
  // check that actually holds. Mirrors the replanFrom rule rebalance enforces.
  for (const b of geoBlocks) {
    if (b.startMin < input.planFromMin - 1) {
      v.push(
        `"${b.title}" starts at ${minutesToHm(b.startMin)}, before the earliest plannable time (${minutesToHm(input.planFromMin)})`,
      );
    }
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

  // --- habits due today must be placed ---
  // `overflow` rows reference a task id (FK to tasks), so a habit cannot be
  // deferred there. A due habit is placed or the plan is wrong.
  for (const h of input.habitsDue) {
    const name = h.name.trim().toLowerCase();
    const placed = plan.blocks.some(
      (b) => b.kind === "habit" && b.title.trim().toLowerCase().includes(name),
    );
    if (!placed) {
      v.push(
        `habit "${h.name}" (${h.durationMin} min${h.preferredWindow ? `, prefers ${h.preferredWindow}` : ""}) is due today but has no habit block — add one, outside the working windows if that is where it belongs`,
      );
    }
  }

  // --- must-do tasks are a hard constraint ---
  const mustDoIds = new Map(
    input.tasks.filter((t) => t.mustDoToday).map((t) => [t.id, t.title]),
  );
  for (const [id, title] of mustDoIds) {
    if (plan.overflow.some((o) => o.taskId === id)) {
      v.push(`"${title}" is marked must-do-today and cannot be sent to overflow`);
    }
    if (!plan.blocks.some((b) => b.kind === "task" && b.taskId === id)) {
      v.push(`"${title}" is marked must-do-today but has no block in the plan`);
    }
  }

  return v;
}
