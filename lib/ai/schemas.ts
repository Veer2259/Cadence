/**
 * lib/ai/schemas.ts — Zod schemas for validated model output (SPEC section 6).
 * The compose schema is used verbatim from SPEC 6.1; it is the source of truth
 * both for the request schema (converted to JSON Schema) and for parsing.
 */

import { z } from "zod";

const block = z.object({
  taskId: z.string().nullable(),
  title: z.string(),
  start: z.string(), // "HH:mm" IST
  end: z.string(),
  kind: z.enum(["task", "fixed", "habit", "break"]),
  category: z.enum(["deep", "shallow", "calls", "admin", "errand", "personal"]),
  estimateMin: z.number().int(),
  reason: z.string().max(90),
});

const overflowItem = z.object({
  taskId: z.string(),
  reason: z.string(),
  action: z.enum(["defer", "shrink", "delegate", "drop"]),
  suggestion: z.string(),
});

export const planSchema = z.object({
  blocks: z.array(block),
  overflow: z.array(overflowItem),
  calibrationNote: z.string().nullable(),
});

export type PlanBlock = z.infer<typeof block>;
export type PlanOverflowItem = z.infer<typeof overflowItem>;
export type PlanResult = z.infer<typeof planSchema>;
