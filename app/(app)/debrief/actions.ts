"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { submitDebrief } from "@/lib/debrief";

const entrySchema = z.object({
  blockId: z.string().uuid(),
  status: z.enum(["done", "partial", "skipped"]),
  actualMin: z.number().int().min(0).max(1440).nullable(),
});

const payloadSchema = z.object({
  planId: z.string().uuid(),
  entries: z.array(entrySchema).max(100),
});

export type DebriefActionResult =
  | {
      ok: true;
      summary: string;
      plannedMin: number;
      loggedMin: number;
      carriedOver: number;
      tasksDone: number;
      calibrationTouched: string[];
    }
  | { ok: false; error: string };

export async function submitDebriefAction(
  input: unknown,
): Promise<DebriefActionResult> {
  await requireAuth();

  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The debrief form could not be read." };

  try {
    const r = await submitDebrief(parsed.data.planId, parsed.data.entries);
    // Not /debrief — that page must keep showing the result panel this returns.
    revalidatePath("/today");
    revalidatePath("/inbox");
    return {
      ok: true,
      summary: r.summary,
      plannedMin: r.plannedMin,
      loggedMin: r.loggedMin,
      carriedOver: r.carriedOver,
      tasksDone: r.tasksDone,
      calibrationTouched: r.calibrationTouched,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the debrief." };
  }
}
