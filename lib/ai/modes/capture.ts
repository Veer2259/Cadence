/**
 * lib/ai/modes/capture.ts — parse a brain dump into tasks. SPEC section 6.2.
 * Runs on the lightweight `capture` model. Writes nothing.
 */

import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, buckets } from "@/db/schema";
import { istToday } from "@/lib/time";
import { runStructured, CallBudget } from "@/lib/ai/provider";
import { BUDGET } from "@/lib/ai/budget";
import { captureSchema, type CaptureResult } from "@/lib/ai/schemas";
import { CAPTURE_SYSTEM_PROMPT } from "@/lib/ai/prompts/capture";

export async function captureFromText(
  text: string,
  answers?: string,
): Promise<CaptureResult> {
  const [bucketRows, activeTasks] = await Promise.all([
    db.select({ name: buckets.name }).from(buckets).where(eq(buckets.active, true)),
    db
      .select({ title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.status, "active"), isNull(tasks.parentId))),
  ]);

  const payload = {
    today: istToday(),
    timezone: "Asia/Kolkata",
    existingBuckets: bucketRows.map((b) => b.name),
    activeTaskTitles: activeTasks.map((t) => t.title),
    dump: text,
    ...(answers ? { answersToEarlierQuestions: answers } : {}),
  };

  return runStructured({
    role: "capture",
    purpose: "capture",
    budget: new CallBudget(BUDGET.capture, "capture"),
    system: CAPTURE_SYSTEM_PROMPT,
    schema: captureSchema,
    schemaName: "captured_tasks",
    messages: [
      {
        role: "user",
        content:
          `Parse this brain dump.\n\n${JSON.stringify(payload, null, 2)}` +
          (answers
            ? "\n\nThe answers above resolve the earlier questions — now emit the tasks."
            : ""),
      },
    ],
  });
}
