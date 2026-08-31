/**
 * lib/ai/modes/week.ts — one model call for the week commentary (SPEC 6.5).
 * All numbers come from lib/pressure.ts; the model only phrases them.
 */

import "server-only";
import { runStructured, StructuredOutputError, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { weekNoteSchema, type WeekNoteResult } from "@/lib/ai/schemas";
import { WEEK_SYSTEM_PROMPT } from "@/lib/ai/prompts/week";
import type { PressureResult } from "@/lib/pressure";

export async function weekCommentary(pressure: PressureResult): Promise<WeekNoteResult> {
  if (pressure.deadlines.length === 0) {
    return { weekNote: "No deadlines in the next two weeks.", deadlines: [] };
  }

  const table = {
    freeHoursByDay: pressure.days.map((d) => ({ date: d.date, freeHours: d.freeHours })),
    deadlines: pressure.deadlines.map((d) => ({
      taskId: d.taskId,
      title: d.title,
      dueDate: d.dueDate,
      hoursNeeded: d.hoursNeeded,
      hoursAvailable: d.hoursAvailable,
      status: d.status,
    })),
  };

  try {
    return await runStructured({
      role: "compose",
      purpose: "week-note",
      budget: new CallBudget(BUDGET.week, "week-note"),
      system: WEEK_SYSTEM_PROMPT,
      schema: weekNoteSchema,
      schemaName: "week_note",
      messages: [
        { role: "user", content: `Comment on this table.\n\n${JSON.stringify(table, null, 2)}` },
      ],
    });
  } catch (e) {
    if (!(e instanceof StructuredOutputError)) console.error("[week] commentary failed:", e);
    const worst = [...pressure.deadlines].sort((a, b) => a.ratio - b.ratio)[0];
    return {
      weekNote:
        worst && worst.status !== "safe"
          ? `${worst.title} is the binding constraint — ${worst.hoursNeeded}h needed, ${worst.hoursAvailable}h free before ${worst.dueDate}.`
          : "Every deadline has enough room this fortnight.",
      deadlines: pressure.deadlines.map((d) => ({
        taskId: d.taskId,
        line: `${d.hoursNeeded}h needed, ${d.hoursAvailable}h available before ${d.dueDate} — ${d.status}.`,
      })),
    };
  }
}
