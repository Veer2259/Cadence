"use server";

import { requireAuth } from "@/lib/auth";
import { computePressure } from "@/lib/pressure";
import { weekCommentary } from "@/lib/ai/modes/week";

export type WeekNotePayload = {
  weekNote: string;
  lines: { taskId: string; line: string }[];
};

export async function getWeekNote(): Promise<
  { ok: true; data: WeekNotePayload } | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const pressure = await computePressure();
    const c = await weekCommentary(pressure);
    return { ok: true, data: { weekNote: c.weekNote, lines: c.deadlines } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the week." };
  }
}
