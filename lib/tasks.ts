/**
 * lib/tasks.ts — shared task creation, used by the inbox capture flow and the
 * chat rail's `create_task` tool.
 */

import "server-only";
import { db } from "@/db";
import { tasks, buckets } from "@/db/schema";

const CATEGORIES = ["deep", "shallow", "calls", "admin", "errand", "personal"] as const;
type Category = (typeof CATEGORIES)[number];

/** Match a bucket by name (case-insensitive), or null. Never creates a bucket. */
export async function resolveBucketId(name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  const all = await db.select({ id: buckets.id, name: buckets.name }).from(buckets);
  return all.find((b) => b.name.toLowerCase() === wanted)?.id ?? null;
}

export type InsertTaskInput = {
  title: string;
  notes?: string | null;
  bucketId?: string | null;
  bucketName?: string | null;
  category?: string | null;
  estimateMin?: number | null;
  dueAt?: Date | null;
  priority?: "low" | "normal" | "high" | null;
  status?: "inbox" | "active";
  mustDoToday?: boolean;
  source: "dump" | "manual" | "voice" | "carryover";
};

export async function insertTask(
  input: InsertTaskInput,
): Promise<{ id: string; title: string }> {
  const bucketId =
    input.bucketId ?? (await resolveBucketId(input.bucketName ?? null));
  const category: Category =
    input.category && (CATEGORIES as readonly string[]).includes(input.category)
      ? (input.category as Category)
      : "shallow";

  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title.trim().slice(0, 200),
      notes: input.notes?.trim() || null,
      bucketId,
      category,
      estimateMin: input.estimateMin ?? null,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? "normal",
      status: input.status ?? "active",
      mustDoToday: input.mustDoToday ?? false,
      source: input.source,
    })
    .returning({ id: tasks.id, title: tasks.title });
  return row;
}

/** Parse a model-supplied ISO string into a Date, or null. */
export function parseIsoOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
