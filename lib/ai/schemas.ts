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

/** Debrief — a two-line factual summary of how the day went (SPEC 6.4). */
export const debriefSummarySchema = z.object({
  summary: z.string().max(280),
});
export type DebriefSummary = z.infer<typeof debriefSummarySchema>;

/** Capture — parse a brain dump into discrete tasks (+ clarifying questions). SPEC 6.2. */
export const captureSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      notes: z.string().nullable(),
      bucketName: z.string().nullable(),
      category: z.enum([
        "deep",
        "shallow",
        "calls",
        "admin",
        "errand",
        "personal",
      ]),
      estimateMin: z.number().int().nullable(),
      dueAt: z.string().nullable(), // ISO
      priority: z.enum(["low", "normal", "high"]),
      possibleDuplicateOf: z.string().nullable(),
    }),
  ),
  clarifications: z.array(z.string()),
});
export type CaptureResult = z.infer<typeof captureSchema>;
export type CapturedTask = CaptureResult["tasks"][number];

/** Week — the model's commentary on the deterministic pressure table. SPEC 6.5. */
export const weekNoteSchema = z.object({
  weekNote: z.string().max(400),
  deadlines: z.array(
    z.object({
      taskId: z.string(),
      line: z.string().max(160),
    }),
  ),
});
export type WeekNoteResult = z.infer<typeof weekNoteSchema>;

/* ------------------------------------------------------------------ */
/*  Breakdown — the conversational goal-setting mode (SPEC 6.7)        */
/* ------------------------------------------------------------------ */

/**
 * One breakdown turn. The mode either keeps interviewing (`question`) or puts
 * a draft on the table (`proposal`). It never writes: the proposal goes to a
 * review list the person confirms or edits.
 */
export const breakdownTurnSchema = z.object({
  /** what to say next — the question, the challenge, or the summary */
  reply: z.string().max(1200),
  /** true once there is enough to propose something concrete */
  ready: z.boolean(),
  proposal: z
    .object({
      outcome: z.string().max(300),
      outcomeTargetDate: z.string().nullable(),
      weeklyTargets: z.array(
        z.object({
          weekStart: z.string(),
          description: z.string().max(300),
          targetHours: z.number().nullable(),
        }),
      ),
      /** the capacity arithmetic behind the proposal, in plain language */
      reasoning: z.string().max(600),
    })
    .nullable(),
});
export type BreakdownTurn = z.infer<typeof breakdownTurnSchema>;

/* ------------------------------------------------------------------ */
/*  Weekly kickoff — candidate tasks for this week's targets (SPEC 6.8) */
/* ------------------------------------------------------------------ */

export const kickoffSchema = z.object({
  candidates: z.array(
    z.object({
      title: z.string().max(200),
      /** which weekly target this serves; must be one of the ids supplied */
      weeklyTargetId: z.string(),
      category: z.enum(["deep", "shallow", "calls", "admin", "errand", "personal"]),
      estimateMin: z.number().int(),
      /** one line: why this task, and why this size */
      reason: z.string().max(160),
    }),
  ),
  /** anything the person should know before accepting — capacity, gaps */
  note: z.string().max(400).nullable(),
});
export type KickoffResult = z.infer<typeof kickoffSchema>;
